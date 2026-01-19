import { Request, Response } from 'express';
import client from '@repo/db';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';

// Trigger types available for Google Calendar
export const TRIGGER_TYPES = {
  // Instant (webhook-based)
  NEW_EVENT: 'new_event',
  EVENT_UPDATED: 'event_updated',

  // Polling-based
  EVENT_START: 'event_start',
  EVENT_ENDED: 'event_ended',
  EVENT_CANCELLED: 'event_cancelled',
  NEW_CALENDAR: 'new_calendar',
  EVENT_MATCHING_SEARCH: 'event_matching_search',
} as const;

const INSTANT_TRIGGERS = [TRIGGER_TYPES.NEW_EVENT, TRIGGER_TYPES.EVENT_UPDATED];

/**
 * Create a Google Calendar trigger
 */
export const createTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const {
      serverId,
      zapId,
      calendarId = 'primary',
      triggerType,
      searchQuery, // For EVENT_MATCHING_SEARCH
      reminderMinutes, // For EVENT_START
    } = req.body;

    // Validate required fields
    if (!serverId || !zapId || !triggerType) {
      return res.status(400).json({
        message: 'Server ID, Zap ID, and trigger type are required',
      });
    }

    // Validate trigger type
    const validTypes = Object.values(TRIGGER_TYPES);
    if (!validTypes.includes(triggerType)) {
      return res.status(400).json({
        message: `Invalid trigger type. Valid types: ${validTypes.join(', ')}`,
      });
    }

    // Verify server belongs to user
    const server = await client.googleCalendarServer.findFirst({
      where: {
        id: serverId,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    // Verify zap belongs to user
    const zap = await client.zap.findFirst({
      where: {
        id: zapId,
        userId: parseInt(userId),
      },
    });

    if (!zap) {
      return res.status(404).json({ message: 'Zap not found' });
    }

    // Check if trigger already exists for this zap
    const existingTrigger = await client.googleCalendarTrigger.findUnique({
      where: { zapId },
    });

    if (existingTrigger) {
      return res.status(400).json({
        message: 'Trigger already exists for this Zap',
      });
    }

    // Validate specific trigger requirements
    if (triggerType === TRIGGER_TYPES.EVENT_MATCHING_SEARCH && !searchQuery) {
      return res.status(400).json({
        message: 'Search query is required for EVENT_MATCHING_SEARCH trigger',
      });
    }

    // Determine if this is an instant trigger
    const isInstant = INSTANT_TRIGGERS.includes(triggerType);

    // Create trigger
    const trigger = await client.googleCalendarTrigger.create({
      data: {
        serverId,
        zapId,
        calendarId,
        triggerType,
        isInstant,
        searchQuery: triggerType === TRIGGER_TYPES.EVENT_MATCHING_SEARCH ? searchQuery : null,
        reminderMinutes: triggerType === TRIGGER_TYPES.EVENT_START ? reminderMinutes || 15 : null,
        isActive: true,
      },
    });

    console.log(
      `📅 Created Calendar trigger ${trigger.id} (type: ${triggerType}, instant: ${isInstant})`
    );

    return res.status(201).json({
      message: 'Google Calendar trigger created successfully',
      trigger: {
        id: trigger.id,
        calendarId: trigger.calendarId,
        triggerType: trigger.triggerType,
        isInstant: trigger.isInstant,
        isActive: trigger.isActive,
      },
    });
  } catch (error) {
    console.error('❌ Error creating Calendar trigger:', error);
    return res.status(500).json({
      message: 'Failed to create trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get user's Google Calendar triggers
 */
export const getTriggers = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId, triggerType } = req.query;

    const triggers = await client.googleCalendarTrigger.findMany({
      where: {
        server: {
          userId: parseInt(userId),
          isActive: true,
          ...(serverId && { id: serverId as string }),
        },
        ...(triggerType && { triggerType: triggerType as string }),
      },
      include: {
        zap: {
          select: { id: true, name: true, isActive: true },
        },
        server: {
          select: { id: true, email: true },
        },
      },
    });

    return res.status(200).json({
      message: 'Triggers retrieved successfully',
      triggers,
    });
  } catch (error) {
    console.error('❌ Error fetching Calendar triggers:', error);
    return res.status(500).json({
      message: 'Failed to fetch triggers',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Update a Google Calendar trigger
 */
export const updateTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const triggerId = req.params.triggerId as string;
    const { calendarId, searchQuery, reminderMinutes, isActive } = req.body;

    if (!triggerId) {
      return res.status(400).json({ message: 'Trigger ID is required' });
    }

    // Verify ownership through server
    const trigger = await client.googleCalendarTrigger.findFirst({
      where: {
        id: triggerId,
        server: {
          userId: parseInt(userId),
        },
      },
    });

    if (!trigger) {
      return res.status(404).json({ message: 'Trigger not found' });
    }

    // Update trigger
    const updated = await client.googleCalendarTrigger.update({
      where: { id: triggerId },
      data: {
        ...(calendarId && { calendarId }),
        ...(searchQuery !== undefined && { searchQuery }),
        ...(reminderMinutes !== undefined && { reminderMinutes }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    // If settings changed, clear cached state
    if (calendarId || searchQuery !== undefined) {
      const redisKey = `calendar:sync_token:${triggerId}`;
      await redis.del(redisKey);
      console.log(`📅 Cleared sync token for trigger ${triggerId}`);
    }

    return res.status(200).json({
      message: 'Trigger updated successfully',
      trigger: updated,
    });
  } catch (error) {
    console.error('❌ Error updating Calendar trigger:', error);
    return res.status(500).json({
      message: 'Failed to update trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Delete a Google Calendar trigger
 */
export const deleteTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const triggerId = req.params.triggerId as string;

    if (!triggerId) {
      return res.status(400).json({ message: 'Trigger ID is required' });
    }

    // Verify ownership through server
    const trigger = await client.googleCalendarTrigger.findFirst({
      where: {
        id: triggerId,
        server: {
          userId: parseInt(userId),
        },
      },
    });

    if (!trigger) {
      return res.status(404).json({ message: 'Trigger not found' });
    }

    // Delete from database
    await client.googleCalendarTrigger.delete({
      where: { id: triggerId },
    });

    // Clean up Redis cached state
    const keysToDelete = [
      `calendar:sync_token:${triggerId}`,
      `calendar:calendar_list:${triggerId}`,
    ];
    for (const key of keysToDelete) {
      await redis.del(key);
    }

    console.log(`📅 Deleted Calendar trigger ${triggerId}`);

    return res.status(200).json({
      message: 'Trigger deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting Calendar trigger:', error);
    return res.status(500).json({
      message: 'Failed to delete trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get available trigger types
 */
export const getTriggerTypes = async (req: Request, res: Response): Promise<any> => {
  return res.status(200).json({
    message: 'Trigger types retrieved',
    types: [
      {
        value: TRIGGER_TYPES.NEW_EVENT,
        label: 'New Event',
        isInstant: true,
        description: 'Triggers when a new event is created',
      },
      {
        value: TRIGGER_TYPES.EVENT_UPDATED,
        label: 'New or Updated Event',
        isInstant: true,
        description: 'Triggers when an event is created or updated',
      },
      {
        value: TRIGGER_TYPES.EVENT_START,
        label: 'Event Start',
        isInstant: false,
        description: 'Triggers X minutes before an event starts',
      },
      {
        value: TRIGGER_TYPES.EVENT_ENDED,
        label: 'Event Ended',
        isInstant: false,
        description: 'Triggers when an event ends',
      },
      {
        value: TRIGGER_TYPES.EVENT_CANCELLED,
        label: 'Event Cancelled',
        isInstant: false,
        description: 'Triggers when an event is cancelled',
      },
      {
        value: TRIGGER_TYPES.NEW_CALENDAR,
        label: 'New Calendar',
        isInstant: false,
        description: 'Triggers when a new calendar is created',
      },
      {
        value: TRIGGER_TYPES.EVENT_MATCHING_SEARCH,
        label: 'New Event Matching Search',
        isInstant: false,
        description: 'Triggers when an event matching search criteria is created',
      },
    ],
  });
};
