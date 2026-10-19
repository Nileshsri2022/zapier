/**
 * BUG: the schedule cron reads due rows (`findMany nextRunAt <= now`), enqueues a
 * run, and only then advances `nextRunAt`. There is no atomic claim, so two
 * overlapping ticks — cron-job.org retrying a slow call, or two Render
 * instances/restarts both answering the same minute — see the same due row and
 * enqueue the SAME scheduled slot twice. The user's Zap fires two runs per tick.
 *
 * Expected (green): one due slot produces at most one ZapRun. A correct fix
 * claims the row first (e.g. `updateMany({ where: { id, nextRunAt: <valueRead> } })`
 * and skip when `count === 0`, or an equivalent lock).
 */
import express from 'express';
import request from 'supertest';
import client from '@repo/db';

jest.mock('@repo/runs', () => ({
  __esModule: true,
  enqueueRun: jest.fn(),
}));

import { enqueueRun } from '@repo/runs';
import CronRouter from '../../apps/server/src/routes/CronRoutes';

const CRON_SECRET = 'cron-secret-for-repro';
process.env.CRON_SECRET = CRON_SECRET;

const app = express();
app.use(express.json());
app.use('/api/cron', CronRouter);

/** In-memory stand-in for the ScheduledTrigger table shared by both ticks. */
const makeStore = () => {
  const dueAt = new Date(Date.now() - 60_000); // already due
  const rows = [
    {
      id: 'sched-1',
      zapId: 'zap-1',
      isActive: true,
      scheduleType: 'minutely',
      timezone: 'UTC',
      nextRunAt: dueAt,
      lastRunAt: null as Date | null,
      zap: { id: 'zap-1', name: 'Daily digest', isActive: true },
    },
  ];

  const tick = () => request(app).get('/api/cron/process-schedules').set('x-cron-secret', CRON_SECRET);

  return {
    rows,
    tick,
    findMany: jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 15)); // DB round trip
      const now = new Date();
      return rows
        .filter((r) => r.isActive && r.nextRunAt <= now && r.zap.isActive)
        .map((r) => ({ ...r }));
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row!, data);
      return { ...row! };
    }),
    // Atomic compare-and-set claim: only the first caller wins a given slot.
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) return { count: 0 };
      if (where.nextRunAt && row.nextRunAt.getTime() !== where.nextRunAt.getTime()) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }),
  };
};

describe('GET /api/cron/process-schedules concurrency', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = makeStore();
    (client.scheduledTrigger as any).findMany = store.findMany;
    (client.scheduledTrigger as any).update = store.update;
    (client.scheduledTrigger as any).updateMany = store.updateMany;
    (enqueueRun as jest.Mock).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20)); // run-intake round trip
      return { status: 'queued', zapRunId: `run-${Math.random()}` };
    });
  });

  it('enqueues the due slot once when two ticks overlap', async () => {
    const [first, second] = await Promise.all([store.tick(), store.tick()]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it('still fires again on the next slot', async () => {
    await store.tick();
    // Advance the schedule into the past again (next minute becomes due).
    store.rows[0].nextRunAt = new Date(Date.now() - 1_000);
    await store.tick();

    expect(enqueueRun).toHaveBeenCalledTimes(2);
  });
});
