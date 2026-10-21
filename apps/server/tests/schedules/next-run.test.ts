import {
  computeNextRun,
  validateCron,
  normalizeCron,
  computeNextCronRun,
  buildScheduleRunPayload,
  presetToCron,
} from '../../src/services/schedule';

const iso = (date: Date) => date.toISOString();

describe('computeNextRun', () => {
  it('runs daily at the selected wall-clock time', () => {
    const next = computeNextRun(
      { scheduleType: 'daily', hour: 9, minute: 0, timezone: 'UTC' },
      new Date('2026-01-01T08:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-01T09:00:00.000Z');
  });

  it('rolls daily runs to the next day once the slot has passed', () => {
    const next = computeNextRun(
      { scheduleType: 'daily', hour: 9, minute: 0, timezone: 'UTC' },
      new Date('2026-01-01T09:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-02T09:00:00.000Z');
  });

  it('converts the selected timezone to UTC (Asia/Kolkata)', () => {
    const next = computeNextRun(
      { scheduleType: 'daily', hour: 9, minute: 0, timezone: 'Asia/Kolkata' },
      new Date('2026-01-01T00:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-01T03:30:00.000Z');
  });

  it('honours dayOfWeek for weekly schedules', () => {
    // Tuesday 2026-01-06; next Monday is 2026-01-12.
    const next = computeNextRun(
      { scheduleType: 'weekly', dayOfWeek: 1, hour: 9, minute: 0, timezone: 'UTC' },
      new Date('2026-01-06T10:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-12T09:00:00.000Z');
  });

  it('keeps midnight as midnight', () => {
    const next = computeNextRun(
      { scheduleType: 'daily', hour: 0, minute: 0, timezone: 'UTC' },
      new Date('2026-01-01T00:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-02T00:00:00.000Z');
  });

  it('does not skip a month at month-end', () => {
    // 2026-01-31, monthly on the 5th -> 2026-02-05 (not March).
    const next = computeNextRun(
      { scheduleType: 'monthly', dayOfMonth: 5, hour: 9, minute: 0, timezone: 'UTC' },
      new Date('2026-01-31T12:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-02-05T09:00:00.000Z');
  });

  it('clamps monthly day to the last day of a short month', () => {
    const next = computeNextRun(
      { scheduleType: 'monthly', dayOfMonth: 31, hour: 9, minute: 0, timezone: 'UTC' },
      new Date('2026-02-01T00:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-02-28T09:00:00.000Z');
  });

  it('handles hourly slots later in the same hour', () => {
    const next = computeNextRun(
      { scheduleType: 'hourly', minute: 30, timezone: 'UTC' },
      new Date('2026-01-01T10:10:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-01T10:30:00.000Z');
  });

  it('handles hourly slots that have already passed', () => {
    const next = computeNextRun(
      { scheduleType: 'hourly', minute: 30, timezone: 'UTC' },
      new Date('2026-01-01T10:40:00.000Z')
    );
    expect(iso(next)).toBe('2026-01-01T11:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// T8 grilled spec (docs/ask-matt/triggers/schedule.md, round 10):
// DST wall-clock (Q-SCHED-03), custom 5-field cron (M5), §4 contract.
// ---------------------------------------------------------------------------

describe('DST wall-clock policy (Q-SCHED-03)', () => {
  it('spring-forward: a nonexistent 02:30 target fires once at the shifted instant', () => {
    // US 2026: clocks jump 02:00 → 03:00 EST→EDT on Sunday, March 8.
    const next = computeNextRun(
      { scheduleType: 'daily', hour: 2, minute: 30, timezone: 'America/New_York' },
      new Date('2026-03-07T12:00:00.000Z')
    );
    // 02:30 does not exist; policy = shift forward to 03:30 EDT (07:30Z).
    expect(iso(next)).toBe('2026-03-08T07:30:00.000Z');
  });

  it('fall-back: the repeated local hour fires on the FIRST occurrence only', () => {
    // US 2026: clocks fall 02:00 → 01:00 EDT→EST on Sunday, November 1.
    // The repeated hour is 01:00–01:59 local: 01:30 happens at 05:30Z (EDT,
    // first) and again at 06:30Z (EST, second).
    const first = computeNextRun(
      { scheduleType: 'daily', hour: 1, minute: 30, timezone: 'America/New_York' },
      new Date('2026-10-31T12:00:00.000Z')
    );
    expect(iso(first)).toBe('2026-11-01T05:30:00.000Z');

    // After the first hit, the next fire is the NEXT day — the repeated
    // 01:30 EST (06:30Z) never fires (exactly once, spec acceptance).
    const afterFirst = computeNextRun(
      { scheduleType: 'daily', hour: 1, minute: 30, timezone: 'America/New_York' },
      new Date('2026-11-01T05:35:00.000Z')
    );
    expect(iso(afterFirst)).toBe('2026-11-02T06:30:00.000Z'); // 01:30 EST next day

    // 02:30 sits outside the repeated window on fall-back day → exactly one
    // run (02:30 EST), matching the spec's 02:30 acceptance wording.
    const outsideWindow = computeNextRun(
      { scheduleType: 'daily', hour: 2, minute: 30, timezone: 'America/New_York' },
      new Date('2026-10-31T12:00:00.000Z')
    );
    expect(iso(outsideWindow)).toBe('2026-11-01T07:30:00.000Z');
  });
});

describe('custom 5-field cron (M5)', () => {
  it('validates ranges, steps, lists and rejects bad fields', () => {
    expect(validateCron('*/15 9-17 * * 1-5')).toMatchObject({
      valid: true,
      normalized: '*/15 9-17 * * 1-5',
    });
    expect(validateCron('  0,30  *  *  *  *  ')).toMatchObject({
      valid: true,
      normalized: '0,30 * * * *',
    });
    expect(validateCron('61 * * * *').valid).toBe(false);
    expect(validateCron('* 24 * * *').valid).toBe(false);
    expect(validateCron('* * * * 8').valid).toBe(false);
    expect(validateCron('* * * *').valid).toBe(false); // 4 fields
    expect(validateCron('0 0 0 * *').valid).toBe(false); // dom min is 1
    expect(validateCron('foo * * * *').valid).toBe(false);
    expect(validateCron('').valid).toBe(false);
  });

  it('normalizes @daily-style aliases to cron for storage', () => {
    expect(normalizeCron('@daily')).toBe('0 0 * * *');
    expect(normalizeCron('@hourly')).toBe('0 * * * *');
    expect(normalizeCron('@weekly')).toBe('0 0 * * 0');
  });

  it('fires */15 9-17 * * 1-5 weekdays in the selected timezone', () => {
    // Wednesday 2026-10-21 08:30 IST → next fires 09:00, 09:15 IST …
    let cursor = new Date('2026-10-21T03:00:00.000Z');
    const fires: string[] = [];
    for (let i = 0; i < 4; i++) {
      cursor = computeNextCronRun('*/15 9-17 * * 1-5', cursor, 'Asia/Kolkata');
      fires.push(iso(cursor));
    }
    expect(fires).toEqual([
      '2026-10-21T03:30:00.000Z', // 09:00 IST
      '2026-10-21T03:45:00.000Z', // 09:15 IST
      '2026-10-21T04:00:00.000Z', // 09:30 IST
      '2026-10-21T04:15:00.000Z', // 09:45 IST
    ]);
  });

  it('skips to the next weekday when the cron includes a day-of-week restriction', () => {
    // Friday 2026-10-23 18:00 IST → Monday 09:00 IST (Sat/Sun excluded).
    const next = computeNextCronRun(
      '0 9 * * 1-5',
      new Date('2026-10-23T12:30:00.000Z'),
      'Asia/Kolkata'
    );
    expect(iso(next)).toBe('2026-10-26T03:30:00.000Z');
  });

  it('routes scheduleType cron through computeNextRun', () => {
    const next = computeNextRun(
      {
        scheduleType: 'cron',
        cronExpression: '@hourly',
        minute: 5,
        timezone: 'UTC',
      },
      new Date('2026-10-21T03:00:00.000Z')
    );
    expect(iso(next)).toBe('2026-10-21T04:00:00.000Z');
  });
});

describe('§4 run contract (Q-SCHED-05)', () => {
  it('matches the spec example for daily 09:00 IST on 2026-10-21', () => {
    const occurrence = new Date('2026-10-21T03:30:00.000Z'); // 09:00 +05:30
    const payload = buildScheduleRunPayload(
      { scheduleType: 'daily', hour: 9, minute: 0, timezone: 'Asia/Kolkata' },
      occurrence
    );

    expect(payload).toMatchObject({
      firedAt: '2026-10-21T09:00:00+05:30',
      firedAtIso: '2026-10-21T03:30:00.000Z',
      timezone: 'Asia/Kolkata',
      mode: 'daily',
      cron: '0 9 * * *',
      date: {
        year: 2026,
        month: 10,
        monthName: 'October',
        week: 43,
        day: 21,
        dayOfWeek: 'Wednesday',
        dayOfYear: 294,
        hour: 9,
        minute: 0,
        second: 0,
        ampm: 'AM',
        isoWeek: 43,
      },
      occurrenceKey: 'daily|2026-10-21T09:00:00+05:30',
    });
    // legacy aliases kept for existing templates
    expect(payload.triggerType).toBe('schedule');
    expect(payload.scheduleType).toBe('daily');
    expect(payload.scheduledAt).toBe('2026-10-21T03:30:00.000Z');
  });

  it('occurrenceKey is stable across recomputes of the same occurrence', () => {
    const spec = {
      scheduleType: 'weekly' as const,
      hour: 9,
      minute: 30,
      dayOfWeek: 1,
      timezone: 'UTC',
    };
    const occurrence = new Date('2026-10-19T09:30:00.000Z');
    const a = buildScheduleRunPayload(spec, occurrence);
    const b = buildScheduleRunPayload(spec, occurrence);
    expect(a.occurrenceKey).toBe(b.occurrenceKey);
    expect(a.occurrenceKey).toBe('weekly|2026-10-19T09:30:00+00:00');
  });

  it('presetToCron derives the contract cron field per mode', () => {
    expect(presetToCron({ scheduleType: 'minutely' })).toBe('* * * * *');
    expect(presetToCron({ scheduleType: 'hourly', minute: 20 })).toBe('20 * * * *');
    expect(presetToCron({ scheduleType: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *');
    expect(presetToCron({ scheduleType: 'weekly', hour: 9, minute: 0, dayOfWeek: 3 })).toBe(
      '0 9 * * 3'
    );
    expect(presetToCron({ scheduleType: 'monthly', hour: 9, minute: 5, dayOfMonth: 15 })).toBe(
      '5 9 15 * *'
    );
  });
});
