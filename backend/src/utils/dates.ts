import { z } from 'zod';
import { unprocessable } from './errors.js';

/**
 * Date handling.
 *
 * Everything is stored and compared in UTC. A "day" for reporting is resolved
 * against the company's timezone, so "today" means today for the partners, not
 * today in UTC — a real difference for an India-based company where UTC+05:30
 * puts the first 5.5 hours of the local day in the previous UTC day.
 */

export const DATE_PRESETS = [
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
  'lastYear',
  'allTime',
  'custom',
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

/** The plain object shape, so callers can `.partial()` or `.extend()` it. */
export const dateRangeQueryShape = z.object({
  preset: z.enum(DATE_PRESETS).default('thisMonth'),
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
});

export const dateRangeQuerySchema = dateRangeQueryShape.refine(
  (v) => v.preset !== 'custom' || (v.from && v.to),
  { message: 'A custom range requires both "from" and "to"', path: ['from'] },
);

export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

/** Minutes to add to UTC to reach local time in `timeZone` on `at`. */
function offsetMinutes(timeZone: string, at: Date): number {
  try {
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
    const parts = Object.fromEntries(
      formatter.formatToParts(at).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    ) as Record<string, string>;

    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour === '24' ? '00' : parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    throw unprocessable(`"${timeZone}" is not a valid IANA timezone`);
  }
}

/** The UTC instant corresponding to local midnight at the start of `date`'s day. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const offset = offsetMinutes(timeZone, date);
  const local = new Date(date.getTime() + offset * 60_000);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  // Recompute the offset at the candidate instant so DST transitions land right.
  const candidate = new Date(localMidnight - offset * 60_000);
  const correctedOffset = offsetMinutes(timeZone, candidate);
  return correctedOffset === offset ? candidate : new Date(localMidnight - correctedOffset * 60_000);
}

export function endOfLocalDay(date: Date, timeZone: string): Date {
  const next = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return new Date(startOfLocalDay(next, timeZone).getTime() - 1);
}

function localParts(date: Date, timeZone: string) {
  const offset = offsetMinutes(timeZone, date);
  const local = new Date(date.getTime() + offset * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate() };
}

function localDate(year: number, month: number, day: number, timeZone: string): Date {
  return startOfLocalDay(new Date(Date.UTC(year, month, day, 12)), timeZone);
}

/**
 * Resolves a preset (or a custom from/to) into a concrete UTC range.
 * `to` is inclusive — the last millisecond of the final local day.
 */
export function resolveDateRange(
  query: Partial<DateRangeQuery>,
  timeZone: string,
  now: Date = new Date(),
): DateRange {
  const preset = query.preset ?? 'thisMonth';
  const { year, month, day } = localParts(now, timeZone);

  const startOfToday = localDate(year, month, day, timeZone);
  const endOfToday = endOfLocalDay(now, timeZone);

  switch (preset) {
    case 'today':
      return { from: startOfToday, to: endOfToday, label: 'Today' };

    case 'yesterday': {
      const from = localDate(year, month, day - 1, timeZone);
      return { from, to: new Date(startOfToday.getTime() - 1), label: 'Yesterday' };
    }

    case 'last7days':
      return { from: localDate(year, month, day - 6, timeZone), to: endOfToday, label: 'Last 7 days' };

    case 'last30days':
      return { from: localDate(year, month, day - 29, timeZone), to: endOfToday, label: 'Last 30 days' };

    case 'thisMonth':
      return { from: localDate(year, month, 1, timeZone), to: endOfToday, label: 'This month' };

    case 'lastMonth': {
      const from = localDate(year, month - 1, 1, timeZone);
      const to = new Date(localDate(year, month, 1, timeZone).getTime() - 1);
      return { from, to, label: 'Last month' };
    }

    case 'thisQuarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        from: localDate(year, quarterStartMonth, 1, timeZone),
        to: endOfToday,
        label: 'This quarter',
      };
    }

    case 'thisYear':
      return { from: localDate(year, 0, 1, timeZone), to: endOfToday, label: 'This year' };

    case 'lastYear': {
      const from = localDate(year - 1, 0, 1, timeZone);
      const to = new Date(localDate(year, 0, 1, timeZone).getTime() - 1);
      return { from, to, label: 'Last year' };
    }

    case 'allTime':
      return { from: new Date(Date.UTC(2000, 0, 1)), to: endOfToday, label: 'All time' };

    case 'custom': {
      if (!query.from || !query.to) throw unprocessable('A custom range requires both "from" and "to"');
      const from = parseBoundary(query.from, timeZone, 'start');
      const to = parseBoundary(query.to, timeZone, 'end');
      if (from > to) throw unprocessable('"from" must not be after "to"');
      return { from, to, label: 'Custom range' };
    }

    default:
      return { from: localDate(year, month, 1, timeZone), to: endOfToday, label: 'This month' };
  }
}

/** A bare "YYYY-MM-DD" is read in company-local time; a full ISO string is exact. */
function parseBoundary(value: string, timeZone: string, edge: 'start' | 'end'): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) throw unprocessable(`"${value}" is not a valid date`);
  if (!dateOnly) return parsed;
  return edge === 'start' ? startOfLocalDay(parsed, timeZone) : endOfLocalDay(parsed, timeZone);
}

/** "2026-10" bucket key for a timestamp, in company-local time. */
export function monthKey(date: Date, timeZone: string): string {
  const { year, month } = localParts(date, timeZone);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function yearKey(date: Date, timeZone: string): string {
  return String(localParts(date, timeZone).year);
}

/** Every month key from `from` to `to`, so a chart has no missing columns. */
export function monthKeysBetween(from: Date, to: Date, timeZone: string): string[] {
  const keys: string[] = [];
  const start = localParts(from, timeZone);
  const end = localParts(to, timeZone);

  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    keys.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    if (keys.length > 600) break; // guard against a pathological range
  }
  return keys;
}

/** Date-only (no time) for DATE columns such as expenseDate and payoutDate. */
export function toDateOnly(value: string | Date): Date {
  const str = typeof value === 'string' ? value : value.toISOString();
  const datePart = str.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw unprocessable(`"${String(value)}" is not a valid date`);
  return parsed;
}
