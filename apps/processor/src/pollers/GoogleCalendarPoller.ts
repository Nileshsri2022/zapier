/**
 * Google Calendar Poller
 * Polls Google Calendar for various event triggers
 */

import { google, calendar_v3 } from 'googleapis';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';
import { BasePoller } from './BasePoller';
import { PollResult } from './types';

export class GoogleCalendarPoller extends BasePoller {
  name = 'google-calendar';
  emoji = '📅';

  /**
   * Main poll method - checks all active Google Calendar triggers
   */
  async poll(): Promise<PollResult> {
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;

    this.logStart();

    try {
      // Get all active polling triggers (not instant ones)
      const triggers = await client.googleCalendarTrigger.findMany({
        where: {
          isActive: true,
          isInstant: false, // Only poll non-instant triggers
          zap: { isActive: true },
        },
        include: {
          server: true,
          zap: true,
        },
      });

      console.log(`${this.emoji} Found ${triggers.length} active Google Calendar polling triggers`);

      for (const trigger of triggers) {
        try {
          const result = await this.pollTrigger(trigger);
          processed += result;
        } catch (error) {
          console.error(`${this.emoji} Error processing trigger ${trigger.id}:`, error);
          errors++;
        }
      }
    } catch (error) {
      console.error(`${this.emoji} Error in Google Calendar polling:`, error);
      errors++;
    }

    const duration = Date.now() - startTime;
    this.logComplete(processed, errors, duration);

    return { service: this.name, processed, errors, duration };
  }

  /**
   * Poll a single trigger based on its type
   */
  private async pollTrigger(trigger: any): Promise<number> {
    // Initialize OAuth2 client
    const oauth2Client = this.getOAuthClient();
    this.setCredentials(oauth2Client, trigger.server);

    // Refresh token if needed
    await this.refreshTokenIfNeeded(trigger.server, oauth2Client, (id, data) =>
      client.googleCalendarServer.update({ where: { id }, data })
    );

    // Initialize Calendar API
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Route to appropriate handler based on trigger type
    let processed = 0;
    switch (trigger.triggerType) {
      case 'event_start':
        processed = await this.pollEventStart(trigger, calendar);
        break;
      case 'event_ended':
        processed = await this.pollEventEnded(trigger, calendar);
        break;
      case 'event_cancelled':
        processed = await this.pollEventCancelled(trigger, calendar);
        break;
      case 'new_calendar':
        processed = await this.pollNewCalendar(trigger, calendar);
        break;
      case 'event_matching_search':
        processed = await this.pollEventMatchingSearch(trigger, calendar);
        break;
      default:
        console.warn(`${this.emoji} Unknown trigger type: ${trigger.triggerType}`);
    }

    // Update last polled timestamp
    await client.googleCalendarTrigger.update({
      where: { id: trigger.id },
      data: { lastPolledAt: new Date() },
    });

    return processed;
  }

  /**
   * Event Start - Triggers X minutes before an event starts
   */
  private async pollEventStart(trigger: any, calendar: calendar_v3.Calendar): Promise<number> {
    const now = new Date();
    const reminderMinutes = trigger.reminderMinutes || 15;
    const windowEnd = new Date(now.getTime() + reminderMinutes * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: trigger.calendarId || 'primary',
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    let processed = 0;
    for (const event of response.data.items || []) {
      if (!event.id) continue;

      // Check if we already triggered for this event
      const redisKey = `calendar:event_start:${trigger.id}:${event.id}`;
      const alreadyTriggered = await redis.get(redisKey);

      if (!alreadyTriggered) {
        await this.createZapRun(trigger.zapId, {
          trigger_type: 'event_start',
          event_id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          location: event.location,
          attendees: event.attendees,
          html_link: event.htmlLink,
        });

        // Mark as triggered (TTL = 24 hours to avoid re-triggering)
        await redis.set(redisKey, '1', 'EX', 86400);
        processed++;
        console.log(`${this.emoji} Event starting soon: ${event.summary}`);
      }
    }

    return processed;
  }

  /**
   * Event Ended - Triggers when an event has just ended
   */
  private async pollEventEnded(trigger: any, calendar: calendar_v3.Calendar): Promise<number> {
    const now = new Date();
    // Check events that ended in the last polling interval (5 minutes)
    const windowStart = new Date(now.getTime() - 5 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: trigger.calendarId || 'primary',
      timeMin: windowStart.toISOString(),
      timeMax: now.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    let processed = 0;
    for (const event of response.data.items || []) {
      if (!event.id || !event.end) continue;

      // Check if event end time is in the past
      const endTime = event.end.dateTime ? new Date(event.end.dateTime) : null;
      if (!endTime || endTime > now) continue;

      const redisKey = `calendar:event_ended:${trigger.id}:${event.id}`;
      const alreadyTriggered = await redis.get(redisKey);

      if (!alreadyTriggered) {
        await this.createZapRun(trigger.zapId, {
          trigger_type: 'event_ended',
          event_id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          location: event.location,
        });

        await redis.set(redisKey, '1', 'EX', 86400);
        processed++;
        console.log(`${this.emoji} Event ended: ${event.summary}`);
      }
    }

    return processed;
  }

  /**
   * Event Cancelled - Uses syncToken to detect deleted events
   */
  private async pollEventCancelled(trigger: any, calendar: calendar_v3.Calendar): Promise<number> {
    const redisKey = `calendar:sync_token:${trigger.id}`;
    const storedSyncToken = (await redis.get(redisKey)) as string | null;

    let processed = 0;

    try {
      if (storedSyncToken) {
        // Use syncToken to get only changes
        const response = await calendar.events.list({
          calendarId: trigger.calendarId || 'primary',
          syncToken: storedSyncToken,
        });

        for (const event of response.data.items || []) {
          // Cancelled events have status 'cancelled'
          if (event.status === 'cancelled' && event.id) {
            await this.createZapRun(trigger.zapId, {
              trigger_type: 'event_cancelled',
              event_id: event.id,
              summary: event.summary || 'Deleted Event',
            });
            processed++;
            console.log(`${this.emoji} Event cancelled: ${event.id}`);
          }
        }

        // Store new syncToken
        if (response.data.nextSyncToken) {
          await redis.set(redisKey, response.data.nextSyncToken, 'EX', 60 * 60 * 24 * 7);
        }
      } else {
        // First time - get events and store syncToken
        const response = await calendar.events.list({
          calendarId: trigger.calendarId || 'primary',
          timeMin: new Date().toISOString(),
          maxResults: 100,
        });

        if (response.data.nextSyncToken) {
          await redis.set(redisKey, response.data.nextSyncToken, 'EX', 60 * 60 * 24 * 7);
        }
      }
    } catch (error: any) {
      // If syncToken is invalid, reset it
      if (error.code === 410) {
        await redis.del(redisKey);
        console.log(`${this.emoji} SyncToken expired, will reset on next poll`);
      } else {
        throw error;
      }
    }

    return processed;
  }

  /**
   * New Calendar - Triggers when a new calendar is created
   */
  private async pollNewCalendar(trigger: any, calendar: calendar_v3.Calendar): Promise<number> {
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];

    const redisKey = `calendar:calendar_list:${trigger.id}`;
    const storedCalendarIds = (await redis.smembers(redisKey)) as string[];

    let processed = 0;
    for (const cal of calendars) {
      if (!cal.id) continue;

      if (!storedCalendarIds.includes(cal.id)) {
        // New calendar detected
        if (storedCalendarIds.length > 0) {
          // Only trigger if we had calendars before (not first poll)
          await this.createZapRun(trigger.zapId, {
            trigger_type: 'new_calendar',
            calendar_id: cal.id,
            summary: cal.summary,
            description: cal.description,
            primary: cal.primary,
          });
          processed++;
          console.log(`${this.emoji} New calendar: ${cal.summary}`);
        }

        // Add to tracked calendars
        await redis.sadd(redisKey, cal.id);
      }
    }

    // Set TTL
    await redis.expire(redisKey, 60 * 60 * 24 * 30);

    return processed;
  }

  /**
   * Event Matching Search - Triggers for new events matching search criteria
   */
  private async pollEventMatchingSearch(
    trigger: any,
    calendar: calendar_v3.Calendar
  ): Promise<number> {
    if (!trigger.searchQuery) {
      console.warn(`${this.emoji} No search query for trigger ${trigger.id}`);
      return 0;
    }

    const now = new Date();
    const lastPolled = trigger.lastPolledAt || new Date(now.getTime() - 5 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: trigger.calendarId || 'primary',
      q: trigger.searchQuery,
      timeMin: lastPolled.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    let processed = 0;
    for (const event of response.data.items || []) {
      if (!event.id) continue;

      const redisKey = `calendar:search_match:${trigger.id}:${event.id}`;
      const alreadyTriggered = await redis.get(redisKey);

      if (!alreadyTriggered) {
        await this.createZapRun(trigger.zapId, {
          trigger_type: 'event_matching_search',
          search_query: trigger.searchQuery,
          event_id: event.id,
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
        });

        await redis.set(redisKey, '1', 'EX', 86400);
        processed++;
        console.log(`${this.emoji} Event matching "${trigger.searchQuery}": ${event.summary}`);
      }
    }

    return processed;
  }
}
