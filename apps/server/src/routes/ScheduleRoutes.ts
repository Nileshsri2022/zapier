import { Router, Request, Response } from 'express';
import client from '@repo/db';
import { authMiddleware } from '../middlewares';

const router = Router();

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
                zap: { userId }
            }
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

        // Validate scheduleType
        const validTypes = ['hourly', 'daily', 'weekly', 'monthly'];
        if (!validTypes.includes(scheduleType)) {
            return res.status(400).json({ error: 'Invalid scheduleType' });
        }

        // Verify Zap ownership
        const zap = await client.zap.findFirst({
            where: { id: zapId, userId }
        });

        if (!zap) {
            return res.status(404).json({ error: 'Zap not found' });
        }

        // Calculate initial nextRunAt
        const nextRunAt = calculateInitialNextRun(scheduleType, hour, minute, dayOfWeek, dayOfMonth);

        const schedule = await client.scheduledTrigger.upsert({
            where: { zapId },
            update: {
                scheduleType,
                hour: hour ?? null,
                minute: minute || 0,
                dayOfWeek: dayOfWeek ?? null,
                dayOfMonth: dayOfMonth ?? null,
                timezone: timezone || 'UTC',
                nextRunAt,
                isActive: true
            },
            create: {
                zapId,
                scheduleType,
                hour: hour ?? null,
                minute: minute || 0,
                dayOfWeek: dayOfWeek ?? null,
                dayOfMonth: dayOfMonth ?? null,
                timezone: timezone || 'UTC',
                nextRunAt
            }
        });

        console.log(`📅 Schedule created/updated for Zap "${zap.name}" - Next run: ${nextRunAt.toISOString()}`);

        res.json({
            success: true,
            schedule,
            message: `Schedule set. Next run: ${nextRunAt.toLocaleString()}`
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
                zap: { userId }
            }
        });

        if (!schedule) {
            return res.status(404).json({ error: 'Schedule not found' });
        }

        const updated = await client.scheduledTrigger.update({
            where: { id: schedule.id },
            data: { isActive: isActive ?? true }
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
                zap: { userId }
            }
        });

        res.json({ success: true, message: 'Schedule removed' });
    } catch (error: any) {
        console.error('Delete schedule error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Calculate the initial next run time for a new schedule
 */
function calculateInitialNextRun(
    scheduleType: string,
    hour?: number,
    minute?: number,
    dayOfWeek?: number,
    dayOfMonth?: number
): Date {
    const now = new Date();
    const next = new Date(now);

    // Reset seconds and milliseconds
    next.setSeconds(0);
    next.setMilliseconds(0);

    switch (scheduleType) {
        case 'hourly':
            // If current minute is past the target, schedule for next hour
            if (now.getMinutes() >= (minute || 0)) {
                next.setHours(next.getHours() + 1);
            }
            next.setMinutes(minute || 0);
            break;

        case 'daily':
            // If current time is past the target, schedule for tomorrow
            const targetTimeToday = new Date(now);
            targetTimeToday.setHours(hour || 0, minute || 0, 0, 0);

            if (now >= targetTimeToday) {
                next.setDate(next.getDate() + 1);
            }
            next.setHours(hour || 0);
            next.setMinutes(minute || 0);
            break;

        case 'weekly':
            const currentDay = now.getDay();
            const targetDay = dayOfWeek ?? 0;
            let daysUntil = (7 + targetDay - currentDay) % 7;

            // If today is the target day, check if time has passed
            if (daysUntil === 0) {
                const targetTimeWeekly = new Date(now);
                targetTimeWeekly.setHours(hour || 0, minute || 0, 0, 0);
                if (now >= targetTimeWeekly) {
                    daysUntil = 7;
                }
            }

            next.setDate(next.getDate() + daysUntil);
            next.setHours(hour || 0);
            next.setMinutes(minute || 0);
            break;

        case 'monthly':
            const targetDate = Math.min(dayOfMonth || 1, 28);

            // If current date is past the target, schedule for next month
            if (now.getDate() > targetDate ||
                (now.getDate() === targetDate && now.getHours() >= (hour || 0))) {
                next.setMonth(next.getMonth() + 1);
            }

            next.setDate(targetDate);
            next.setHours(hour || 0);
            next.setMinutes(minute || 0);
            break;

        default:
            // Default: 1 hour from now
            next.setHours(next.getHours() + 1);
    }

    return next;
}

export default router;
