import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Money } from '@/types/api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

function fractionDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * Formats a decimal money STRING for display.
 *
 * The string is only converted to a number at the very last moment, for
 * `Intl.NumberFormat`. Amounts are never stored or arithmetic'd as numbers —
 * the API is the only thing that does money maths.
 */
export function formatMoney(
  amount: Money | null | undefined,
  currency = 'INR',
  options: { compact?: boolean; showSign?: boolean; locale?: string } = {},
): string {
  if (amount === null || amount === undefined || amount === '') return '—';

  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';

  const digits = fractionDigits(currency);
  const locale = options.locale ?? (currency === 'INR' ? 'en-IN' : 'en-US');

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: options.compact ? 0 : digits,
    maximumFractionDigits: options.compact ? 1 : digits,
    notation: options.compact ? 'compact' : 'standard',
  }).format(value);

  if (options.showSign && value > 0) return `+${formatted}`;
  return formatted;
}

/** Numeric value of a money string, for charts only. */
export function moneyToNumber(amount: Money | null | undefined): number {
  if (!amount) return 0;
  const value = Number(amount);
  return Number.isFinite(value) ? value : 0;
}

export function isNegative(amount: Money | null | undefined): boolean {
  return moneyToNumber(amount) < 0;
}

export function formatNumber(value: number, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: string | number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(digits)}%`;
}

/** Date in the viewer's chosen timezone. Stored timestamps are always UTC. */
export function formatDate(
  value: string | Date | null | undefined,
  options: { withTime?: boolean; timeZone?: string; locale?: string } = {},
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(options.locale ?? 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(options.withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');
  const diffMonths = Math.round(diffDays / 30);
  return rtf.format(diffMonths, 'month');
}

/** "2026-10" to "Oct 2026" for chart axes. */
export function formatMonthKey(month: string): string {
  const [year, m] = month.split('-');
  if (!year || !m) return month;
  const date = new Date(Number(year), Number(m) - 1, 1);
  return new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' }).format(date);
}

/** Turns an enum constant into readable text: MONTHLY_SUBSCRIPTION → Monthly subscription. */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Today in the given timezone as YYYY-MM-DD, for date inputs. */
export function todayInTimezone(timeZone = 'Asia/Kolkata'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
