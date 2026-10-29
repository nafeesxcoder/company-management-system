import { describe, expect, it } from 'vitest';
import {
  endOfLocalDay,
  monthKey,
  monthKeysBetween,
  resolveDateRange,
  startOfLocalDay,
  toDateOnly,
} from '../../src/utils/dates.js';

const IST = 'Asia/Kolkata'; // UTC+05:30, no DST
const NY = 'America/New_York'; // DST transitions

describe('local day boundaries', () => {
  it('resolves IST midnight to 18:30 UTC the previous day', () => {
    // 2026-10-13T20:00:00Z is 2026-10-14 01:30 IST, so the IST day began
    // at 2026-10-13T18:30:00Z.
    const start = startOfLocalDay(new Date('2026-10-13T20:00:00Z'), IST);
    expect(start.toISOString()).toBe('2026-10-13T18:30:00.000Z');
  });

  it('ends a local day one millisecond before the next begins', () => {
    const at = new Date('2026-10-13T20:00:00Z');
    const end = endOfLocalDay(at, IST);
    expect(end.toISOString()).toBe('2026-10-14T18:29:59.999Z');
  });

  it('handles a DST timezone without drifting', () => {
    const summer = startOfLocalDay(new Date('2026-07-15T16:00:00Z'), NY); // EDT, UTC-4
    expect(summer.toISOString()).toBe('2026-07-15T04:00:00.000Z');

    const winter = startOfLocalDay(new Date('2026-01-15T16:00:00Z'), NY); // EST, UTC-5
    expect(winter.toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });
});

describe('resolveDateRange', () => {
  const now = new Date('2026-10-13T20:00:00Z'); // 2026-10-14 01:30 IST

  it('"today" uses the company timezone, not UTC', () => {
    const range = resolveDateRange({ preset: 'today' }, IST, now);
    // The local day is 14 Oct IST, which started at 13 Oct 18:30 UTC.
    expect(range.from.toISOString()).toBe('2026-10-13T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-14T18:29:59.999Z');
  });

  it('"thisMonth" starts at the first local day of the month', () => {
    const range = resolveDateRange({ preset: 'thisMonth' }, IST, now);
    expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // 1 Oct IST
  });

  it('"lastMonth" is a closed range ending just before this month', () => {
    const range = resolveDateRange({ preset: 'lastMonth' }, IST, now);
    expect(range.from.toISOString()).toBe('2026-08-31T18:30:00.000Z'); // 1 Sep IST
    expect(range.to.toISOString()).toBe('2026-09-30T18:29:59.999Z');
  });

  it('"last7days" spans seven local days inclusive', () => {
    const range = resolveDateRange({ preset: 'last7days' }, IST, now);
    expect(range.from.toISOString()).toBe('2026-10-07T18:30:00.000Z'); // 8 Oct IST
  });

  it('"thisYear" starts on 1 January local', () => {
    const range = resolveDateRange({ preset: 'thisYear' }, IST, now);
    expect(range.from.toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('"thisQuarter" starts at the quarter boundary', () => {
    const range = resolveDateRange({ preset: 'thisQuarter' }, IST, now);
    expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // Q4 starts 1 Oct
  });

  it('reads a bare custom date in local time', () => {
    const range = resolveDateRange({ preset: 'custom', from: '2026-10-01', to: '2026-10-31' }, IST, now);
    expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-31T18:29:59.999Z');
  });

  it('rejects an inverted custom range', () => {
    expect(() =>
      resolveDateRange({ preset: 'custom', from: '2026-10-31', to: '2026-10-01' }, IST, now),
    ).toThrow(/must not be after/i);
  });

  it('rejects an invalid timezone rather than silently using UTC', () => {
    expect(() => resolveDateRange({ preset: 'today' }, 'Not/AZone', now)).toThrow(/valid IANA timezone/i);
  });
});

describe('bucket keys', () => {
  it('buckets a timestamp into the local month', () => {
    // 30 Sep 2026 19:00 UTC is already 1 Oct in IST.
    expect(monthKey(new Date('2026-09-30T19:00:00Z'), IST)).toBe('2026-10');
    expect(monthKey(new Date('2026-09-30T17:00:00Z'), IST)).toBe('2026-09');
  });

  it('produces a continuous month series with no gaps', () => {
    const keys = monthKeysBetween(new Date('2026-11-05T00:00:00Z'), new Date('2027-02-05T00:00:00Z'), IST);
    expect(keys).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('toDateOnly', () => {
  it('strips the time component for DATE columns', () => {
    expect(toDateOnly('2026-10-13T18:45:12.345Z').toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(toDateOnly('2026-10-13').toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('rejects nonsense', () => {
    expect(() => toDateOnly('not-a-date')).toThrow();
  });
});
