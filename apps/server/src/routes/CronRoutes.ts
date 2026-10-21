import { Router, Request, Response } from 'express';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { renewExpiringGmailWatches, pollActiveGmailServers } from '../services/gmailWatch';
import { computeNextRun, buildScheduleRunPayload } from '../services/schedule';

const router = Router();

/**
 * Missed-window grace (Q-SCHED-04: skip missed occurrences): a due slot
 * further behind than this is NOT fired late — the row jumps to the next
 * future occurrence instead (no catch-up burst after downtime). Normal
 * one-minute cron jitter falls well inside the grace window.
 */
export const MISSED_WINDOW_GRACE_MS = 5 * 60 * 1000;

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

    let fired = 0;
    let skippedMissed = 0;

    for (const schedule of dueSchedules) {
      try {
        const dueInstant = schedule.nextRunAt ?? now;

        // Q-SCHED-04 — skip missed windows: the process was down across this
        // occurrence; it is never emitted, we resume at the next one.
        if (now.getTime() - dueInstant.getTime() > MISSED_WINDOW_GRACE_MS) {
          const resumeAt = computeNextRun(schedule, now);
          await client.scheduledTrigger.update({
            where: { id: schedule.id },
            data: { nextRunAt: resumeAt },
          });
          skippedMissed++;
          console.log(
            `⏭️ Missed window for Zap "${schedule.zap.name}" (due ${dueInstant.toISOString()}) skipped — resuming ${resumeAt.toISOString()}`
          );
          continue;
        }

        // §4 contract: local wall-clock parts + occurrenceKey built from the
        // SCHEDULED instant (late sweeps still report the right occurrence).
        const metadata = buildScheduleRunPayload(schedule, dueInstant);

        const result = await enqueueRun({
          zapId: schedule.zapId,
          metadata,
          source: 'server.schedule',
          // Q-SCHED-05/§5: occurrenceKey is the idempotency token — two
          // schedulers racing on the same slot collapse to one effective run.
          dedup: { scope: 'schedule', key: `${schedule.zapId}:${metadata.occurrenceKey}` },
        });

        // Advance for queued AND duplicate: a replayed sweep must not spin on
        // the same row forever (duplicate ⇒ this slot is already accounted
        // for by the winning sweep).
        if (result.status === 'duplicate') {
          console.log(`🔁 Duplicate occurrence ${metadata.occurrenceKey} — advancing only`);
          await client.scheduledTrigger.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt: computeNextRun(schedule, now),
            },
          });
          continue;
        }

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

        fired++;
        console.log(
          `✅ Schedule triggered for Zap "${schedule.zap.name}" (ZapRun ${result.zapRunId} queued, ${metadata.occurrenceKey}) - Next run: ${nextRunAt.toISOString()}`
        );
      } catch (error) {
        console.error(`❌ Failed to process schedule ${schedule.id}:`, error);
      }
    }

    res.json({
      success: true,
      processed: dueSchedules.length,
      fired,
      skippedMissed,
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

/**
 * GET /api/cron/poll-gmail
 * Polling fallback for Gmail (grilled Q-GMAIL-02: push primary + polling
 * fallback). Lists each active server's history delta from the stored
 * cursor when the profile historyId advanced — catches missed push
 * notifications without duplicate fires (dedup claims absorb overlap).
 * Same x-cron-secret protection (fail closed).
 */
router.get('/poll-gmail', async (req: Request, res: Response): Promise<any> => {
  const cronSecret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
    console.log('⚠️ Unauthorized cron request (poll-gmail)');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await pollActiveGmailServers();
    return res.json({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Gmail poll fallback failed:', error);
    return res.status(500).json({
      error: 'Gmail poll fallback failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
