import { Router, Request, Response } from 'express';
import client from '@repo/db';
import axios from 'axios';

const router = Router();

/**
 * GET /api/cron/process-schedules
 * Called by cron-job.org every minute
 * Secured with a secret token
 */
router.get('/process-schedules', async (req: Request, res: Response): Promise<any> => {
  // Verify cron secret
  const cronSecret = req.headers['x-cron-secret'];
  if (cronSecret !== process.env.CRON_SECRET) {
    console.log('⚠️ Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // Find due schedules
    const dueSchedules = await client.scheduledTrigger.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: now },
        zap: { isActive: true },
      },
      include: { zap: true },
    });

    if (dueSchedules.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        message: 'No schedules due',
        timestamp: now.toISOString(),
      });
    }

    console.log(`⏰ Processing ${dueSchedules.length} due schedule(s)`);

    for (const schedule of dueSchedules) {
      try {
        // Create ZapRun
        const zapRun = await client.zapRun.create({
          data: {
            zapId: schedule.zapId,
            metadata: {
              triggerType: 'schedule',
              scheduleType: schedule.scheduleType,
              scheduledAt: now.toISOString(),
              timezone: schedule.timezone,
            },
          },
        });

        // Calculate next run time
        const nextRunAt = calculateNextRun(schedule);

        // Update schedule
        await client.scheduledTrigger.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt: nextRunAt,
          },
        });

        // Trigger processing via hooks service webhook
        const hooksUrl = process.env.HOOKS_URL || 'https://zapier-hooks-bqyy.onrender.com';
        try {
          await axios.post(
            `${hooksUrl}/api/webhooks/schedule`,
            {
              zapRunId: zapRun.id,
              stage: 1,
            },
            {
              headers: { 'Content-Type': 'application/json' },
              timeout: 5000,
            }
          );
        } catch (webhookError) {
          // Even if webhook fails, ZapRun is created - processor can pick it up
          console.log(`⚠️ Webhook notification failed, ZapRun ${zapRun.id} created`);
        }

        console.log(
          `✅ Schedule triggered for Zap "${schedule.zap.name}" - Next run: ${nextRunAt.toISOString()}`
        );
      } catch (error) {
        console.error(`❌ Failed to process schedule ${schedule.id}:`, error);
      }
    }

    res.json({
      success: true,
      processed: dueSchedules.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error('Cron error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Calculate the next run time based on schedule type
 */
function calculateNextRun(schedule: any): Date {
  const now = new Date();
  const next = new Date(now);

  switch (schedule.scheduleType) {
    case 'minutely':
      // Run every minute
      next.setMinutes(next.getMinutes() + 1);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;

    case 'hourly':
      // Run at specified minute every hour
      next.setHours(next.getHours() + 1);
      next.setMinutes(schedule.minute || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;

    case 'daily':
      // Run at specified hour:minute every day
      next.setDate(next.getDate() + 1);
      next.setHours(schedule.hour || 0);
      next.setMinutes(schedule.minute || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;

    case 'weekly': {
      // Run on specified day of week at specified time
      const currentDay = now.getDay();
      const targetDay = schedule.dayOfWeek ?? 0;
      let daysUntilNext = (7 + targetDay - currentDay) % 7;
      if (daysUntilNext === 0) daysUntilNext = 7; // If today, schedule for next week

      next.setDate(next.getDate() + daysUntilNext);
      next.setHours(schedule.hour || 0);
      next.setMinutes(schedule.minute || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;
    }

    case 'monthly':
      // Run on specified day of month at specified time
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(schedule.dayOfMonth || 1, 28)); // Cap at 28 for safety
      next.setHours(schedule.hour || 0);
      next.setMinutes(schedule.minute || 0);
      next.setSeconds(0);
      next.setMilliseconds(0);
      break;

    default:
      // Default: 1 hour from now
      next.setHours(next.getHours() + 1);
  }

  return next;
}

export default router;
