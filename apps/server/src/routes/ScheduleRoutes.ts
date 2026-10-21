import { Router, Request, Response } from 'express';
import client from '@repo/db';
import { authMiddleware } from '../middlewares';
import { computeNextRun, validateCron, normalizeCron, previewNextFires, ScheduleSpec } from '../services/schedule';

const router = Router();

/**
 * POST /api/schedule/preview
 * T8 M5 — next-fires preview before save (5-field cron + presets).
 * Deliberately unauthenticated: pure computation over caller-supplied
 * fields (no user data), so the editor can preview before the Zap exists.
 */
router.post('/preview', async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      scheduleType,
      hour,
      minute,
      dayOfWeek,
      dayOfMonth,
      timezone,
      cron,
      cronExpression,
      count,
    } = req.body || {};

    const rawCron = typeof cron === 'string' ? cron : cronExpression;
    const spec: ScheduleSpec = {
      scheduleType: scheduleType || (rawCron ? 'cron' : ''),
      hour: hour ?? null,
      minute: minute ?? 0,
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      timezone: timezone || 'UTC',
      cronExpression: null,
    };

    if (spec.scheduleType === 'cron') {
      const check = validateCron(String(rawCron ?? ''));
      if (!check.valid) {
        return res.status(400).json({ error: check.error, fires: [] });
      }
      spec.cronExpression = check.normalized as string;
    }

    const n = Math.min(Math.max(Number(count) || 5, 1), 10);
    return res.json({ fires: previewNextFires(spec, n), cron: spec.cronExpression });
  } catch (error: any) {
    console.error('Schedule preview error:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/schedule/:zapId
 * Get schedule for a specific Zap
 */
router.get('/:zapId', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const { zapId } = req.params;
    // @ts-ignore
    const userId = req.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const schedule = await client.scheduledTrigger.findFirst({
      where: {
        zapId: zapId as string,
        zap: { userId },
      },
    });

    res.json({ schedule });
  } catch (error: any) {
    console.error('Get schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/schedule
 * Create or update schedule for a Zap
 */
router.post('/', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { zapId, scheduleType, hour, minute, dayOfWeek, dayOfMonth, timezone } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!zapId || !scheduleType) {
      return res.status(400).json({ error: 'zapId and scheduleType are required' });
    }

    // Validate scheduleType (T8: 'cron' = custom 5-field M5)
    const validTypes = ['minutely', 'hourly', 'daily', 'weekly', 'monthly', 'cron'];
    if (!validTypes.includes(scheduleType)) {
      return res.status(400).json({ error: 'Invalid scheduleType' });
    }

    let cronExpression: string | null = null;
    if (scheduleType === 'cron') {
      const check = validateCron(String(req.body.cronExpression ?? req.body.cron ?? ''));
      if (!check.valid) {
        return res.status(400).json({ error: check.error });
      }
      cronExpression = check.normalized as string;
    }

    // Verify Zap ownership
    const zap = await client.zap.findFirst({
      where: { id: zapId, userId },
    });

    if (!zap) {
      return res.status(404).json({ error: 'Zap not found' });
    }

    // Calculate initial nextRunAt
    const nextRunAt = computeNextRun(
      { scheduleType, hour, minute, dayOfWeek, dayOfMonth, cronExpression, timezone },
      new Date()
    );

    // Upsert replaces the whole schedule atomically — a mode change cancels
    // prior occurrences (no orphan fires; T8 §5).
    const schedule = await client.scheduledTrigger.upsert({
      where: { zapId },
      update: {
        scheduleType,
        hour: hour ?? null,
        minute: minute || 0,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        cronExpression,
        timezone: timezone || 'UTC',
        nextRunAt,
        isActive: true,
      },
      create: {
        zapId,
        scheduleType,
        hour: hour ?? null,
        minute: minute || 0,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        cronExpression,
        timezone: timezone || 'UTC',
        nextRunAt,
      },
    });

    console.log(
      `📅 Schedule created/updated for Zap "${zap.name}" - Next run: ${nextRunAt.toISOString()}`
    );

    res.json({
      success: true,
      schedule,
      message: `Schedule set. Next run: ${nextRunAt.toLocaleString()}`,
    });
  } catch (error: any) {
    console.error('Create schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/schedule/:zapId
 * Toggle schedule active status
 */
router.put('/:zapId', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const { zapId } = req.params;
    // @ts-ignore
    const userId = req.id;
    const { isActive } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const schedule = await client.scheduledTrigger.findFirst({
      where: {
        zapId: zapId as string,
        zap: { userId },
      },
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    const nextActive = isActive ?? true;
    const updated = await client.scheduledTrigger.update({
      where: { id: schedule.id },
      data: {
        isActive: nextActive,
        // Resuming a paused schedule must not fire immediately for every
        // slot missed while it was off.
        ...(nextActive && !schedule.isActive
          ? { nextRunAt: computeNextRun(schedule, new Date()) }
          : {}),
      },
    });

    res.json({ success: true, schedule: updated });
  } catch (error: any) {
    console.error('Update schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/schedule/:zapId
 * Remove schedule for a Zap
 */
router.delete('/:zapId', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const { zapId } = req.params;
    // @ts-ignore
    const userId = req.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await client.scheduledTrigger.deleteMany({
      where: {
        zapId: zapId as string,
        zap: { userId },
      },
    });

    res.json({ success: true, message: 'Schedule removed' });
  } catch (error: any) {
    console.error('Delete schedule error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
