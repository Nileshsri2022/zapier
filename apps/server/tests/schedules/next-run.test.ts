import { computeNextRun } from '../../src/services/schedule';

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
