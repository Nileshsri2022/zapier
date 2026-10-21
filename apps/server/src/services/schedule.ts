/**
 * Timezone-aware schedule arithmetic.
 *
 * The editor lets users pick a timezone and a weekday, so a schedule must be
 * evaluated on the user's wall clock, not the server's local clock. This
 * module contains the single implementation used by Zap creation, the
 * schedule CRUD API, and the cron tick.
 */

export type ScheduleType = 'minutely' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleSpec {
  scheduleType: string;
  hour?: number | string | null;
  minute?: number | string | null;
  dayOfWeek?: number | string | null;
  dayOfMonth?: number | string | null;
  timezone?: string | null;
  /** 5-field cron expression — required when scheduleType === 'cron'. */
  cronExpression?: string | null;
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

/** Offset (ms) of `timeZone` at instant `at`: wall-clock-as-UTC minus real. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const w = zonedParts(at, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - at.getTime();
}

function wallAsUtcMs(parts: ZonedParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
}

/**
 * Convert wall-clock parts in `timeZone` to the corresponding UTC instant.
 *
 * DST policy (Q-SCHED-03, local wall-clock):
 * - Normal times: probe the offset before the target and convert directly.
 * - Ambiguous times (fall-back, wall time occurs twice): the pre-transition
 *   offset probe lands on the FIRST occurrence — which then fires once
 *   (the later duplicate is unreachable because the next run advances past
 *   it).
 * - Nonexistent times (spring-forward gap): neither offset maps back to the
 *   target wall time, so we shift FORWARD to the first valid instant whose
 *   wall clock is ≥ the target (02:30 → 03:30 on gap days).
 */
function toUtc(parts: ZonedParts, timeZone: string): Date {
  const targetAsUtc = wallAsUtcMs(parts);

  const offBefore = zoneOffsetMs(new Date(targetAsUtc - 12 * 3600 * 1000), timeZone);
  const candidate1 = targetAsUtc - offBefore;
  if (wallAsUtcMs(zonedParts(new Date(candidate1), timeZone)) === targetAsUtc) {
    return new Date(candidate1);
  }

  const offAfter = zoneOffsetMs(new Date(targetAsUtc + 12 * 3600 * 1000), timeZone);
  const candidate2 = targetAsUtc - offAfter;
  if (wallAsUtcMs(zonedParts(new Date(candidate2), timeZone)) === targetAsUtc) {
    return new Date(candidate2);
  }

  // Nonexistent local time: shift forward to the first valid instant ≥ target.
  return new Date(Math.max(candidate1, candidate2));
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

// ---------------------------------------------------------------------------
// Custom 5-field cron (M5, Q-SCHED-01) — validated at setup, aliases
// normalized to cron for storage (§5).
// ---------------------------------------------------------------------------

const CRON_ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

interface CronFieldSpec {
  min: number;
  max: number;
}

const CRON_FIELDS: CronFieldSpec[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (7 == 0)
];

// Expand one cron field ('*', '7', '1-5', star-slash-15 steps, '1,3,5'
// mixtures) to a set. Returns null when the field is invalid.
function expandCronField(field: string, spec: CronFieldSpec): Set<number> | null {
  const out = new Set<number>();
  for (const part of String(field ?? '').split(',')) {
    const stepSplit = part.split('/');
    const rangePart = stepSplit[0] ?? '';
    const stepRaw = stepSplit[1];
    let step = 1;
    if (stepSplit.length > 1) {
      step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) return null;
    }
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes('-')) {
      const nums = rangePart.split('-').map(Number);
      const a = nums[0];
      const b = nums[1];
      if (a === undefined || b === undefined || !Number.isInteger(a) || !Number.isInteger(b)) {
        return null;
      }
      start = a;
      end = b;
    } else {
      const n = Number(rangePart);
      if (rangePart === '' || !Number.isInteger(n)) return null;
      start = n;
      end = stepSplit.length > 1 ? spec.max : n;
    }
    if (start < spec.min || end > spec.max || start > end) return null;
    for (let v = start; v <= end; v += step) out.add(v === 7 ? 0 : v);
  }
  return out.size > 0 ? out : null;
}

export interface CronValidation {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/** Validate a 5-field cron expression (M5) and normalize aliases/spacing. */
export function validateCron(raw: string): CronValidation {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { valid: false, error: 'Cron expression is required' };
  }
  const trimmed = raw.trim().toLowerCase();
  const alias = CRON_ALIASES[trimmed];
  const expr = (alias ?? trimmed).replace(/\s+/g, ' ').trim();
  const fields = expr.split(' ');
  if (fields.length !== 5) {
    return {
      valid: false,
      error: 'Expected a 5-field cron expression (minute hour dom month dow)',
    };
  }
  const names = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
  for (let i = 0; i < 5; i++) {
    const field = fields[i] ?? '';
    const fieldSpec = CRON_FIELDS[i];
    if (!fieldSpec || expandCronField(field, fieldSpec) === null) {
      return { valid: false, error: `Invalid ${names[i]} field: "${field}"` };
    }
  }
  return { valid: true, normalized: expr };
}

/** Normalize aliases to stored cron form; throws nothing — invalid returns input. */
export function normalizeCron(raw: string): string {
  const result = validateCron(raw);
  return result.valid ? (result.normalized as string) : String(raw ?? '').trim();
}

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

function parseCron(expr: string): ParsedCron | null {
  const v = validateCron(expr);
  if (!v.valid) return null;
  const fields = (v.normalized as string).split(' ');
  const f0 = fields[0] ?? '';
  const f1 = fields[1] ?? '';
  const f2 = fields[2] ?? '';
  const f3 = fields[3] ?? '';
  const f4 = fields[4] ?? '';
  const [mSpec, hSpec, domSpec, monthSpec, dowSpec] = [
    CRON_FIELDS[0],
    CRON_FIELDS[1],
    CRON_FIELDS[2],
    CRON_FIELDS[3],
    CRON_FIELDS[4],
  ];
  if (!mSpec || !hSpec || !domSpec || !monthSpec || !dowSpec) return null;
  return {
    minutes: expandCronField(f0, mSpec)!,
    hours: expandCronField(f1, hSpec)!,
    dom: expandCronField(f2, domSpec)!,
    months: expandCronField(f3, monthSpec)!,
    dow: expandCronField(f4, dowSpec)!,
    domRestricted: f2 !== '*',
    dowRestricted: f4 !== '*',
  };
}

/**
 * First instant strictly after `from` matching the 5-field cron in `tz`.
 * Day-scan with wall-clock candidate construction (cheap, DST-safe via
 * `toUtc`). Bounded to ~400 days; unreachable crons fall back to +400d.
 */
export function computeNextCronRun(expr: string, from: Date, timeZone: string): Date {
  const cron = parseCron(expr);
  if (!cron) return new Date(from.getTime() + 400 * 24 * 3600 * 1000);

  const start = zonedParts(from, timeZone);
  const sortedHours = [...cron.hours].sort((a, b) => a - b);
  const sortedMinutes = [...cron.minutes].sort((a, b) => a - b);

  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  const limit = cursor + 400 * 24 * 3600 * 1000;

  while (cursor <= limit) {
    const d = new Date(cursor);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dow = d.getUTCDay();

    // Vixie-cron semantics: restricted dom AND restricted dow = OR; otherwise AND.
    const domMatch = cron.dom.has(day);
    const dowMatch = cron.dow.has(dow);
    const dayMatches =
      cron.months.has(month) &&
      (cron.domRestricted && cron.dowRestricted
        ? domMatch || dowMatch
        : cron.domRestricted
          ? domMatch
          : cron.dowRestricted
            ? dowMatch
            : true);

    if (dayMatches) {
      for (const hour of sortedHours) {
        for (const minute of sortedMinutes) {
          const candidate = toUtc({ year, month, day, hour, minute, second: 0 }, timeZone);
          if (candidate.getTime() > from.getTime()) {
            return candidate;
          }
        }
      }
    }
    cursor += 24 * 3600 * 1000;
  }

  return new Date(from.getTime() + 400 * 24 * 3600 * 1000);
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

      let candidate = toUtc({ ...addDays(today, daysUntil), hour, minute, second: 0 }, timeZone);
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
        candidate = candidateInMonth(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1);
      }
      return candidate;
    }

    case 'cron': {
      const expr = spec.cronExpression ? normalizeCron(spec.cronExpression) : '';
      if (!expr) {
        // Misconfigured cron schedule — keep the previous safe default.
        return new Date(from.getTime() + 60 * 60 * 1000);
      }
      return computeNextCronRun(expr, from, timeZone);
    }

    default: {
      // Unknown type: keep the previous safe default of one hour later.
      return new Date(from.getTime() + 60 * 60 * 1000);
    }
  }
}

// ---------------------------------------------------------------------------
// §4 run contract (Q-SCHED-05) — local wall-clock date parts + occurrenceKey
// ---------------------------------------------------------------------------

/** Canonical 5-field cron for a preset (contract's `cron` field). */
export function presetToCron(spec: ScheduleSpec): string {
  const minute = clamp(numeric(spec.minute, 0), 0, 59);
  const hour = clamp(numeric(spec.hour, 0), 0, 23);
  switch (spec.scheduleType) {
    case 'minutely':
      return '* * * * *';
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${clamp(numeric(spec.dayOfWeek, 0), 0, 6)}`;
    case 'monthly':
      return `${minute} ${hour} ${clamp(numeric(spec.dayOfMonth, 1), 1, 31)} * *`;
    case 'cron':
      return spec.cronExpression ? normalizeCron(spec.cronExpression) : '';
    default:
      return '';
  }
}

/** ISO-8601 week number (1..53) for a calendar date. */
function isoWeekNumber(year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

function dayOfYear(year: number, month: number, day: number): number {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / (24 * 3600 * 1000));
}

/** Local ISO string with numeric offset: 2026-10-21T09:00:00+05:30 */
function localIsoWithOffset(occurrence: Date, timeZone: string): { iso: string; offsetMs: number } {
  const w = zonedParts(occurrence, timeZone);
  // Compare second-to-second: wall parts have no milliseconds, so strip them
  // from the instant too (otherwise 17:02:31.437 yields a +05:29 offset).
  const instantWholeSeconds = occurrence.getTime() - occurrence.getMilliseconds();
  const offsetMs = wallAsUtcMs(w) - instantWholeSeconds;
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  const oh = String(Math.floor(abs / (3600 * 1000))).padStart(2, '0');
  const om = String(Math.floor((abs % (3600 * 1000)) / (60 * 1000))).padStart(2, '0');
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${oh}:${om}`;
  return { iso, offsetMs };
}

function partFormatter(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...opts });
}

/**
 * §4 data contract for a scheduled occurrence.
 * `occurrence` is the scheduled instant (the due nextRunAt), not "now" —
 * late sweeps still report the occurrence they belong to.
 */
export function buildScheduleRunPayload(spec: ScheduleSpec, occurrence: Date): Record<string, any> {
  const timeZone = resolveTimezone(spec.timezone);
  const mode = spec.scheduleType;
  const cron = presetToCron(spec);
  const w = zonedParts(occurrence, timeZone);
  const { iso: firedAt, offsetMs } = localIsoWithOffset(occurrence, timeZone);

  const monthName = partFormatter(timeZone, { month: 'long' }).format(occurrence);
  const dayOfWeekName = partFormatter(timeZone, { weekday: 'long' }).format(occurrence);
  const ampm = w.hour < 12 ? 'AM' : 'PM';
  const jan1Dow = new Date(Date.UTC(w.year, 0, 1)).getUTCDay();
  const week = Math.floor((dayOfYear(w.year, w.month, w.day) - 1 + jan1Dow) / 7) + 1;

  return {
    // Spec contract (§4)
    firedAt,
    firedAtIso: occurrence.toISOString(),
    timezone: timeZone,
    mode,
    cron,
    date: {
      year: w.year,
      month: w.month,
      monthName,
      week,
      day: w.day,
      dayOfWeek: dayOfWeekName,
      dayOfYear: dayOfYear(w.year, w.month, w.day),
      hour: w.hour,
      minute: w.minute,
      second: w.second,
      ampm,
      isoWeek: isoWeekNumber(w.year, w.month, w.day),
    },
    occurrenceKey: `${mode}|${firedAt}`,
    // Legacy aliases (existing templates/filters depend on these)
    triggerType: 'schedule',
    scheduleType: mode,
    scheduledAt: occurrence.toISOString(),
    timezone_offset_ms: offsetMs,
  };
}

/**
 * Next N fire instants for the editor's preview (M5: next-fires preview
 * before save). Bounded and cheap — used only at configuration time.
 */
export function previewNextFires(
  spec: ScheduleSpec,
  count = 5
): Array<{ local: string; iso: string }> {
  const timeZone = resolveTimezone(spec.timezone);
  const fires: Array<{ local: string; iso: string }> = [];
  let cursor = new Date();
  for (let i = 0; i < count; i++) {
    const next = computeNextRun(spec, cursor);
    if (next.getTime() <= cursor.getTime()) break;
    const { iso: local } = localIsoWithOffset(next, timeZone);
    fires.push({ local, iso: next.toISOString() });
    cursor = next;
  }
  return fires;
}
