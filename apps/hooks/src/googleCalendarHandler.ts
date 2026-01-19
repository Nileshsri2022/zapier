/**
 * Google Calendar Webhook Handler
 *
 * Handles push notifications from Google Calendar API for instant triggers.
 * Google Calendar uses push notifications (webhooks) to notify about changes.
 *
 * @see https://developers.google.com/calendar/api/guides/push
 */

import { Request, Response } from 'express';
import { google, calendar_v3 } from 'googleapis';
import client from '@repo/db';

// Channel state for push notifications
interface GoogleCalendarNotification {
  channelId: string; // X-Goog-Channel-ID header
  resourceId: string; // X-Goog-Resource-ID header
  resourceState: string; // X-Goog-Resource-State header (sync, exists, not_exists)
  resourceUri: string; // X-Goog-Resource-URI header
  messageNumber: string; // X-Goog-Message-Number header
  expiration?: string; // X-Goog-Channel-Expiration header
}

/**
 * Create OAuth2 client with environment credentials
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Parse Google Calendar push notification headers
 */
function parseNotificationHeaders(req: Request): GoogleCalendarNotification | null {
  const channelId = req.headers['x-goog-channel-id'] as string;
  const resourceId = req.headers['x-goog-resource-id'] as string;
  const resourceState = req.headers['x-goog-resource-state'] as string;
  const resourceUri = req.headers['x-goog-resource-uri'] as string;
  const messageNumber = req.headers['x-goog-message-number'] as string;
  const expiration = req.headers['x-goog-channel-expiration'] as string;

  if (!channelId || !resourceId || !resourceState) {
    return null;
  }

  return {
    channelId,
    resourceId,
    resourceState,
    resourceUri: resourceUri || '',
    messageNumber: messageNumber || '0',
    expiration,
  };
}

/**
 * Handle Google Calendar webhook (push notification)
 */
export async function handleGoogleCalendarWebhook(req: Request, res: Response): Promise<any> {
  // Google requires immediate 200 response
  res.status(200).send('OK');

  try {
    const notification = parseNotificationHeaders(req);

    if (!notification) {
      console.log('📅 Invalid Calendar notification - missing headers');
      return;
    }

    console.log(`📅 Received Calendar notification:`, {
      channelId: notification.channelId,
      resourceState: notification.resourceState,
      messageNumber: notification.messageNumber,
    });

    // Sync notification is just for confirming channel setup
    if (notification.resourceState === 'sync') {
      console.log('📅 Sync notification received - channel confirmed');
      return;
    }

    // Find trigger by channel ID
    const trigger = await client.googleCalendarTrigger.findFirst({
      where: {
        watchChannelId: notification.channelId,
        isActive: true,
      },
      include: {
        server: true,
        zap: true,
      },
    });

    if (!trigger) {
      console.log(`📅 No trigger found for channel: ${notification.channelId}`);
      return;
    }

    if (!trigger.zap.isActive) {
      console.log(`📅 Zap ${trigger.zapId} is inactive, skipping`);
      return;
    }

    console.log(`📅 Processing webhook for trigger ${trigger.id}, zap ${trigger.zapId}`);

    // Initialize OAuth client
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: trigger.server.refreshToken,
      access_token: trigger.server.accessToken,
      expiry_date: trigger.server.tokenExpiry?.getTime(),
    });

    // Refresh token if needed
    const now = Date.now();
    if (trigger.server.tokenExpiry && now >= trigger.server.tokenExpiry.getTime() - 60000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      if (credentials.access_token && credentials.expiry_date) {
        await client.googleCalendarServer.update({
          where: { id: trigger.server.id },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date),
          },
        });
      }
    }

    // Fetch recent changes using sync token
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      const response = await calendar.events.list({
        calendarId: trigger.calendarId || 'primary',
        syncToken: trigger.syncToken || undefined,
      });

      const events = response.data.items || [];
      console.log(`📅 Fetched ${events.length} changed events`);

      for (const event of events) {
        if (!event.id) continue;

        // Determine event type based on status
        let eventType = 'event_updated';
        if (event.status === 'cancelled') {
          // Skip cancelled events for new_event trigger
          if (trigger.triggerType === 'new_event') continue;
          eventType = 'event_cancelled';
        }

        // Check if this is a new event or update
        // New events won't have been seen before
        const isNewEvent = !event.updated || event.created === event.updated;

        if (trigger.triggerType === 'new_event' && !isNewEvent) {
          // Skip updates for new_event trigger
          continue;
        }

        // Create ZapRun
        const zapRun = await client.zapRun.create({
          data: {
            zapId: trigger.zapId,
            metadata: JSON.parse(
              JSON.stringify({
                trigger_type: isNewEvent ? 'new_event' : eventType,
                event_id: event.id,
                summary: event.summary,
                description: event.description,
                start: event.start,
                end: event.end,
                location: event.location,
                status: event.status,
                attendees: event.attendees,
                html_link: event.htmlLink,
                created: event.created,
                updated: event.updated,
              })
            ),
          },
        });

        await client.zapRunOutbox.create({
          data: { zapRunId: zapRun.id },
        });

        console.log(`📅 Created ZapRun ${zapRun.id} for event ${event.summary}`);
      }

      // Update sync token for incremental sync
      if (response.data.nextSyncToken) {
        await client.googleCalendarTrigger.update({
          where: { id: trigger.id },
          data: { syncToken: response.data.nextSyncToken },
        });
      }
    } catch (error: any) {
      // If sync token is invalid, reset it
      if (error.code === 410) {
        console.log(`📅 Sync token expired for trigger ${trigger.id}, resetting`);
        await client.googleCalendarTrigger.update({
          where: { id: trigger.id },
          data: { syncToken: null },
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Error processing Calendar webhook:', error);
  }
}

/**
 * Set up a watch channel for a calendar (called when creating instant trigger)
 */
export async function setupCalendarWatch(
  triggerId: string,
  calendarId: string,
  oauth2Client: any
): Promise<{ channelId: string; resourceId: string; expiry: Date } | null> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Generate unique channel ID
    const channelId = `zapmate-${triggerId}-${Date.now()}`;

    // Webhook endpoint URL
    const webhookUrl =
      process.env.GOOGLE_CALENDAR_WEBHOOK_URL ||
      `${process.env.HOOKS_URL || 'https://your-hooks-service.com'}/api/webhooks/google-calendar`;

    // Create watch request
    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        // Expiration in milliseconds (max 7 days = 604800000ms)
        expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const resourceId = response.data.resourceId;
    const expiry = new Date(parseInt(response.data.expiration || '0'));

    console.log(
      `📅 Set up watch channel ${channelId} for calendar ${calendarId}, expires ${expiry.toISOString()}`
    );

    return {
      channelId,
      resourceId: resourceId || '',
      expiry,
    };
  } catch (error) {
    console.error('❌ Error setting up calendar watch:', error);
    return null;
  }
}

/**
 * Stop a watch channel
 */
export async function stopCalendarWatch(
  channelId: string,
  resourceId: string,
  oauth2Client: any
): Promise<boolean> {
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    });

    console.log(`📅 Stopped watch channel ${channelId}`);
    return true;
  } catch (error) {
    console.error('❌ Error stopping calendar watch:', error);
    return false;
  }
}
