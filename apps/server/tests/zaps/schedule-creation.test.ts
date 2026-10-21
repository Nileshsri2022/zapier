import client from '@repo/db';
import { ZapCompositionError, composeZap } from '../../src/services/zapComposition';

/**
 * Schedule composition, asserted where it happens: `composeZap` computes the
 * first run from the user's wall clock, timezone and day rules, and validates a
 * custom cron *before* anything is written.
 */

const buildTx = (capture: (data: any) => void) => ({
  zap: {
    create: jest.fn().mockResolvedValue({ id: 'zap-1' }),
    update: jest.fn().mockResolvedValue({}),
  },
  trigger: { create: jest.fn().mockResolvedValue({ id: 'trigger-1' }) },
  scheduledTrigger: {
    create: jest.fn().mockImplementation(async ({ data }: any) => {
      capture(data);
      return data;
    }),
  },
});

const runCompose = async (triggerMetadata: any, triggerType = 'Schedule Every Week') => {
  let scheduled: any;
  const tx = buildTx((data) => (scheduled = data));

  (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({
    id: 'trigger-schedule',
    type: triggerType,
  });
  (client.availableActions.findUnique as jest.Mock).mockResolvedValue({ type: 'Webhook' });

  await composeZap({ triggerId: 'trigger-schedule', triggerMetadata, steps: [] }, { userId: 1 });

  return scheduled;
};

describe('composeZap — Schedule trigger nextRunAt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('honours dayOfWeek for weekly schedules', async () => {
    // Tuesday 2026-01-06 10:00 UTC; user asked for Monday 09:00 UTC.
    jest.setSystemTime(new Date('2026-01-06T10:00:00.000Z'));

    const scheduled = await runCompose({
      hour: 9,
      minute: 0,
      dayOfWeek: 1,
      timezone: 'UTC',
    });

    expect(scheduled.nextRunAt.toISOString()).toBe('2026-01-12T09:00:00.000Z');
  });

  it('honours the selected timezone for daily schedules', async () => {
    // 2026-01-01 00:00 UTC is 05:30 in Asia/Kolkata. 09:00 IST is the same day.
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const scheduled = await runCompose(
      {
        hour: 9,
        minute: 0,
        timezone: 'Asia/Kolkata',
      },
      'Schedule Every Day'
    );

    expect(scheduled.nextRunAt.toISOString()).toBe('2026-01-01T03:30:00.000Z');
  });

  it('keeps midnight as midnight instead of turning it into 09:00', async () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const scheduled = await runCompose(
      {
        hour: 0,
        minute: 0,
        timezone: 'UTC',
      },
      'Schedule Every Day'
    );

    expect(scheduled.nextRunAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// T8 M5 — custom 5-field cron (docs/ask-matt/triggers/schedule.md)
// ---------------------------------------------------------------------------

describe('composeZap — Schedule Custom Cron (M5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a cron-scheduled trigger with normalized expression + first run', async () => {
    // Wednesday 2026-10-21 03:00 UTC = 08:30 IST → next */15 9-17 fire = 09:00 IST.
    jest.setSystemTime(new Date('2026-10-21T03:00:00.000Z'));

    const scheduled = await runCompose(
      {
        cron: '*/15 9-17 * * 1-5',
        timezone: 'Asia/Kolkata',
      },
      'Schedule Custom Cron'
    );

    expect(scheduled.scheduleType).toBe('cron');
    expect(scheduled.cronExpression).toBe('*/15 9-17 * * 1-5');
    expect(scheduled.nextRunAt.toISOString()).toBe('2026-10-21T03:30:00.000Z');
  });

  it('rejects an invalid cron before creating anything', async () => {
    const tx = buildTx(() => {});
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({
      id: 'trigger-schedule',
      type: 'Schedule Custom Cron',
    });
    (client.availableActions.findUnique as jest.Mock).mockResolvedValue({ type: 'Webhook' });

    await expect(
      composeZap(
        { triggerId: 'trigger-schedule', triggerMetadata: { cron: '99 * * * *' }, steps: [] },
        { userId: 1 }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CRON' });

    // Validation runs before the transaction: nothing was written.
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
