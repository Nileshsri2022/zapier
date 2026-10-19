/**
 * Timezone-aware schedule arithmetic.
 *
 * The editor lets users pick a timezone and a weekday, so a schedule must be
 * evaluated on the user's wall clock, not the server's local clock. This
 * module contains the single implementation used by Zap creation, the
 * schedule CRUD API, and the cron tick.
 */

export type ScheduleType = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface ScheduleSpec {
  scheduleType: string;
  hour?: number | string | null;
  minute?: number | string | null;
  dayOfWeek?: number | string | null;
  dayOfMonth?: number | string | null;
  timezone?: string | null;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const DEFAULT_TIMEZONE = 'UTC';

function resolveTimezone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    // Throws RangeError for an invalid IANA zone.
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    // `hour` is reported as 24 for midnight in some ICU versions.
    hour: values.hour % 24,
    minute: values.minute,
    second: values.second,
  };
}

/**
 * Convert wall-clock parts in `timeZone` to the corresponding UTC instant.
 * The iterative correction handles DST offsets (and is stable for zones
 * without DST).
 */
function toUtc(parts: ZonedParts, timeZone: string): Date {
  const targetAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );

  let guess = targetAsUtc;
  for (let i = 0; i < 3; i++) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const delta = targetAsUtc - actualAsUtc;
    if (delta === 0) break;
    guess += delta;
  }

  return new Date(guess);
}

function addDays(parts: ZonedParts, days: number): ZonedParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function numeric(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Return the first occurrence strictly after `from` for the given schedule.
 */
export function computeNextRun(spec: ScheduleSpec, from: Date = new Date()): Date {
  const timeZone = resolveTimezone(spec.timezone);
  const minute = clamp(numeric(spec.minute, 0), 0, 59);
  const hour = clamp(numeric(spec.hour, 0), 0, 23);
  const now = zonedParts(from, timeZone);

  switch (spec.scheduleType) {
    case 'minutely': {
      const next = new Date(from.getTime());
      next.setSeconds(0, 0);
      return new Date(next.getTime() + 60 * 1000);
    }

    case 'hourly': {
      // Normalise hour/day overflow (e.g. 23:xx + 1) with UTC arithmetic,
      // then interpret the resulting wall clock in the schedule timezone.
      const normalised = new Date(
        Date.UTC(
          now.year,
          now.month - 1,
          now.day,
          minute > now.minute ? now.hour : now.hour + 1,
          minute,
          0
        )
      );
      return toUtc(
        {
          year: normalised.getUTCFullYear(),
          month: normalised.getUTCMonth() + 1,
          day: normalised.getUTCDate(),
          hour: normalised.getUTCHours(),
          minute: normalised.getUTCMinutes(),
          second: 0,
        },
        timeZone
      );
    }

    case 'daily': {
      let candidate = toUtc({ ...now, hour, minute, second: 0 }, timeZone);
      if (candidate.getTime() <= from.getTime()) {
        candidate = toUtc({ ...addDays(now, 1), hour, minute, second: 0 }, timeZone);
      }
      return candidate;
    }

    case 'weekly': {
      const targetDay = clamp(numeric(spec.dayOfWeek, 0), 0, 6);
      const today = now;
      const currentDay = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
      let daysUntil = (targetDay - currentDay + 7) % 7;

      let candidate = toUtc(
        { ...addDays(today, daysUntil), hour, minute, second: 0 },
        timeZone
      );
      if (candidate.getTime() <= from.getTime()) {
        daysUntil += 7;
        candidate = toUtc({ ...addDays(today, daysUntil), hour, minute, second: 0 }, timeZone);
      }
      return candidate;
    }

    case 'monthly': {
      const targetDay = clamp(numeric(spec.dayOfMonth, 1), 1, 31);

      const candidateInMonth = (year: number, month: number) =>
        toUtc(
          {
            year,
            month,
            day: Math.min(targetDay, daysInMonth(year, month)),
            hour,
            minute,
            second: 0,
          },
          timeZone
        );

      let candidate = candidateInMonth(now.year, now.month);
      if (candidate.getTime() <= from.getTime()) {
        const nextMonth = new Date(Date.UTC(now.year, now.month, 1));
        candidate = candidateInMonth(
          nextMonth.getUTCFullYear(),
          nextMonth.getUTCMonth() + 1
        );
      }
      return candidate;
    }

    default: {
      // Unknown type: keep the previous safe default of one hour later.
      return new Date(from.getTime() + 60 * 60 * 1000);
    }
  }
}
