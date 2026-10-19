import { Router, Request, Response } from 'express';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { renewExpiringGmailWatches } from '../services/GmailDispatch';
import { computeNextRun } from '../services/schedule';

const router = Router();

/**
 * GET /api/cron/process-schedules
 * Called by cron-job.org every minute
 * Secured with a secret token
 */
router.get('/process-schedules', async (req: Request, res: Response): Promise<any> => {
  // Verify cron secret
  const cronSecret = req.headers['x-cron-secret'];
  // Fail closed: an unset CRON_SECRET must reject, not allow
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
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
        const result = await enqueueRun({
          zapId: schedule.zapId,
          metadata: {
            triggerType: 'schedule',
            scheduleType: schedule.scheduleType,
            scheduledAt: now.toISOString(),
            timezone: schedule.timezone,
          },
          source: 'server.schedule',
        });

        if (result.status !== 'queued') {
          console.log(
            `ℹ️ Schedule for Zap "${schedule.zap.name}" skipped (${result.status})`
          );
          continue;
        }

        // Calculate next run time
        const nextRunAt = computeNextRun(schedule, now);

        // Update schedule
        await client.scheduledTrigger.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: now,
            nextRunAt: nextRunAt,
          },
        });

        console.log(
          `✅ Schedule triggered for Zap "${schedule.zap.name}" (ZapRun ${result.zapRunId} queued) - Next run: ${nextRunAt.toISOString()}`
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
 * GET /api/cron/renew-gmail-watches
 * Gmail watches expire after 7 days; the external cron calls this daily
 * to renew any expiring within 24 hours (gmail-worker-routing-spec §4.4).
 * Same x-cron-secret protection as process-schedules (fail closed).
 */
router.get('/renew-gmail-watches', async (req: Request, res: Response): Promise<any> => {
  const cronSecret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    console.log('⚠️ Unauthorized cron request (renew-gmail-watches)');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await renewExpiringGmailWatches();
    return res.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Gmail watch renewal failed:', error);
    return res.status(500).json({
      error: 'Gmail watch renewal failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
