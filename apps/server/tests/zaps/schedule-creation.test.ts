import { Request, Response } from 'express';
import client from '@repo/db';
import * as ZapController from '../../src/controllers/ZapController';

/**
 * The editor offers a timezone and a day-of-week, so the initial nextRunAt
 * for a Schedule trigger must honour both. The current inline math always
 * schedules weekly runs seven days out and computes daily/hourly slots in
 * the server's local time.
 */

const app = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status };
};

const request = (triggerMetaData: any) =>
  ({
    body: {
      availableTriggerId: 'trigger-schedule',
      triggerMetaData,
      actions: [],
    },
    // @ts-ignore - set by auth middleware
    id: 'user-1',
  }) as unknown as Request;

const runCreate = async (triggerMetaData: any, triggerType = 'Schedule Every Week') => {
  let scheduled: any;
  const tx = {
    availableTriggers: {
      findUnique: jest.fn().mockResolvedValue({ type: triggerType }),
    },
    zap: {
      create: jest.fn().mockResolvedValue({ id: 'zap-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    trigger: { create: jest.fn().mockResolvedValue({ id: 'trigger-1' }) },
    googleSheetsTrigger: { create: jest.fn() },
    googleCalendarTrigger: { create: jest.fn() },
    scheduledTrigger: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        scheduled = data;
        return data;
      }),
    },
  };
  (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

  const { res, status } = app();
  await ZapController.createZap(request(triggerMetaData), res);
  expect(status).toHaveBeenCalledWith(201);
  return scheduled;
};

describe('createZap — Schedule trigger nextRunAt', () => {
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

    const scheduled = await runCreate({
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

    const scheduled = await runCreate(
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

    const scheduled = await runCreate(
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
