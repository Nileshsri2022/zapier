import request from 'supertest';
import express from 'express';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import CronRouter from '../../src/routes/CronRoutes';
import ScheduleRouter from '../../src/routes/ScheduleRoutes';

/**
 * T8 sweep fixtures (docs/ask-matt/triggers/schedule.md round 10):
 * occurrenceKey idempotency, skip-missed (no catch-up), §4 contract,
 * duplicate advance, cron preview endpoint.
 */

const app = express();
app.use(express.json());
app.use('/api/cron', CronRouter);
app.use('/api/schedule', ScheduleRouter);

const originalEnv = { ...process.env };

const makeSchedule = (overrides: any = {}) => ({
  id: 'sched-1',
  zapId: 'zap-1',
  scheduleType: 'daily',
  hour: 9,
  minute: 0,
  dayOfWeek: null,
  dayOfMonth: null,
  cronExpression: null,
  timezone: 'Asia/Kolkata',
  nextRunAt: new Date(Date.now() - 30 * 1000), // due, inside grace
  isActive: true,
  zap: { id: 'zap-1', name: 'IST Daily', isActive: true },
  ...overrides,
});

let mockDue: any[] = [];
const mockTriggerUpdate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
  mockTriggerUpdate.mockResolvedValue({});
  mockDue = [makeSchedule()];
  (client.scheduledTrigger.findMany as jest.Mock).mockImplementation(async () => mockDue);
  (client.scheduledTrigger.update as jest.Mock) = mockTriggerUpdate;
  process.env.CRON_SECRET = 'cron-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

const sweep = () =>
  request(app).get('/api/cron/process-schedules').set('x-cron-secret', 'cron-secret');

describe('process-schedules — contract + idempotency', () => {
  it('fires a due occurrence with the §4 contract and occurrenceKey dedupe', async () => {
    const res = await sweep();

    expect(res.status).toBe(200);
    expect(res.body.fired).toBe(1);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const input = mockEnqueueRun.mock.calls[0][0];
    const m = input.metadata;
    expect(m).toMatchObject({
      triggerType: 'schedule',
      scheduleType: 'daily',
      timezone: 'Asia/Kolkata',
      mode: 'daily',
      cron: '0 9 * * *',
      date: expect.objectContaining({
        monthName: expect.any(String),
        dayOfWeek: expect.any(String),
        isoWeek: expect.any(Number),
        ampm: expect.stringMatching(/^(AM|PM)$/),
      }),
    });
    // occurrenceKey = <mode>|<localISO> — local wall time of the DUE slot
    expect(m.occurrenceKey).toMatch(/^daily\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
    expect(m.firedAt).toBe(m.occurrenceKey.replace('daily|', ''));
    expect(input.dedup).toEqual({
      scope: 'schedule',
      key: `zap-1:${m.occurrenceKey}`,
    });
    // row advances for the next occurrence
    expect(mockTriggerUpdate).toHaveBeenCalledTimes(1);
    expect(mockTriggerUpdate.mock.calls[0][0].data.nextRunAt).toBeInstanceOf(Date);
  });

  it('duplicate occurrence (second scheduler) acks without firing and still advances', async () => {
    mockEnqueueRun.mockResolvedValue({ status: 'duplicate' });

    const res = await sweep();

    expect(res.status).toBe(200);
    expect(res.body.fired).toBe(0);
    expect(mockTriggerUpdate).toHaveBeenCalledTimes(1); // advance-only
  });

  it('skips missed windows: a slot past the grace never fires (no catch-up)', async () => {
    mockDue = [makeSchedule({ nextRunAt: new Date(Date.now() - 10 * 60 * 1000) })];

    const res = await sweep();

    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(res.body.skippedMissed).toBe(1);
    expect(res.body.fired).toBe(0);
    const data = mockTriggerUpdate.mock.calls[0][0].data;
    expect(data.nextRunAt.getTime()).toBeGreaterThan(Date.now()); // resumed in the future
    expect(data.lastRunAt).toBeUndefined(); // skipped ≠ ran
  });

  it('rejects the sweep without the cron secret (fail closed)', async () => {
    delete process.env.CRON_SECRET;
    const res = await request(app).get('/api/cron/process-schedules');
    expect(res.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('custom cron schedules sweep with mode cron and the stored expression', async () => {
    mockDue = [
      makeSchedule({
        scheduleType: 'cron',
        cronExpression: '*/15 9-17 * * 1-5',
        hour: null,
        nextRunAt: new Date(Date.now() - 10 * 1000),
      }),
    ];

    await sweep();

    const m = mockEnqueueRun.mock.calls[0][0].metadata;
    expect(m.mode).toBe('cron');
    expect(m.cron).toBe('*/15 9-17 * * 1-5');
    expect(m.occurrenceKey.startsWith('cron|')).toBe(true);
  });
});

describe('POST /api/schedule/preview (M5 next-fires)', () => {
  it('returns five local fires for a valid cron in the selected timezone', async () => {
    const res = await request(app)
      .post('/api/schedule/preview')
      .send({ scheduleType: 'cron', cron: '*/15 9-17 * * 1-5', timezone: 'Asia/Kolkata', count: 5 });

    expect(res.status).toBe(200);
    expect(res.body.fires).toHaveLength(5);
    expect(res.body.fires[0].local).toMatch(/T\d{2}:\d{2}:\d{2}\+05:30$/);
    // monotonic
    const times = res.body.fires.map((f: any) => Date.parse(f.iso));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('rejects an invalid cron with the field error', async () => {
    const res = await request(app)
      .post('/api/schedule/preview')
      .send({ scheduleType: 'cron', cron: '99 * * * *', timezone: 'UTC' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minute/i);
    expect(res.body.fires).toEqual([]);
  });

  it('normalizes aliases in the preview response', async () => {
    const res = await request(app)
      .post('/api/schedule/preview')
      .send({ scheduleType: 'cron', cron: '@daily', timezone: 'UTC' });

    expect(res.status).toBe(200);
    expect(res.body.cron).toBe('0 0 * * *');
    expect(res.body.fires[0].local).toMatch(/T00:00:00\+00:00$/);
  });

  it('previews presets too (daily)', async () => {
    const res = await request(app)
      .post('/api/schedule/preview')
      .send({ scheduleType: 'daily', hour: 9, minute: 0, timezone: 'UTC', count: 3 });

    expect(res.status).toBe(200);
    expect(res.body.fires).toHaveLength(3);
    expect(res.body.fires[0].local).toMatch(/T09:00:00\+00:00$/);
  });
});
