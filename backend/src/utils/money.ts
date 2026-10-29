import { Decimal } from 'decimal.js';
import { currencyMismatch, unprocessable } from './errors.js';

/**
 * All money in this system is decimal. Never float.
 *
 * Prisma returns its own Decimal implementation; we normalise everything through
 * `toDecimal()` into decimal.js so there is exactly one arithmetic engine in the
 * codebase and rounding behaviour is identical everywhere.
 */

// 28 significant digits is far more than DECIMAL(18,4) needs; ROUND_HALF_UP
// matches standard accounting rounding.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -18, toExpPos: 21 });

export { Decimal };

/** Anything that can safely become a Decimal. Note: `number` is accepted only for
 *  literals in tests/seed data — never for values that came off the wire. */
export type DecimalInput = Decimal | string | number | { toString(): string };

export const ZERO = new Decimal(0);

/** Minor-unit (decimal places) per ISO currency. Default is 2. */
const CURRENCY_MINOR_UNITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

const ISO_CURRENCY_RE = /^[A-Z]{3}$/;

export function assertCurrencyCode(code: string): string {
  const upper = code?.toUpperCase?.() ?? '';
  if (!ISO_CURRENCY_RE.test(upper)) {
    throw unprocessable(`"${code}" is not a valid ISO-4217 currency code`);
  }
  return upper;
}

export function minorUnits(currency: string): number {
  return CURRENCY_MINOR_UNITS[assertCurrencyCode(currency)] ?? 2;
}

export function toDecimal(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO;
  if (value instanceof Decimal) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw unprocessable('Monetary value must be a finite number');
    return new Decimal(value.toString());
  }
  const asString = typeof value === 'string' ? value : value.toString();
  try {
    return new Decimal(asString);
  } catch {
    throw unprocessable(`"${asString}" is not a valid monetary value`);
  }
}

/** Rounds to the currency's minor units and returns the canonical DECIMAL(18,4) string. */
export function toMoneyString(value: DecimalInput, currency: string): string {
  return roundToCurrency(value, currency).toFixed(4);
}

export function roundToCurrency(value: DecimalInput, currency: string): Decimal {
  return toDecimal(value).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_UP);
}

/** Serialises a Decimal for JSON. Money crosses the wire as a string so no
 *  client can silently turn it into a float. */
export function serializeMoney(value: DecimalInput, currency: string): string {
  return roundToCurrency(value, currency).toFixed(minorUnits(currency));
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

export function isNegative(value: DecimalInput): boolean {
  return toDecimal(value).isNegative();
}

export function assertNonNegative(value: DecimalInput, field: string): Decimal {
  const d = toDecimal(value);
  if (d.isNegative()) throw unprocessable(`${field} must not be negative`);
  return d;
}

export function assertPositive(value: DecimalInput, field: string): Decimal {
  const d = toDecimal(value);
  if (d.lessThanOrEqualTo(0)) throw unprocessable(`${field} must be greater than zero`);
  return d;
}

export function assertSameCurrency(a: string, b: string, context: string): string {
  const ca = assertCurrencyCode(a);
  const cb = assertCurrencyCode(b);
  if (ca !== cb) {
    throw currencyMismatch(`${context}: currency ${ca} does not match ${cb}`, { expected: ca, received: cb });
  }
  return ca;
}

/**
 * Converts an amount into the company's base currency.
 *
 * `rate` is "1 unit of `from` = rate units of `base`". A null rate for a
 * non-base currency is an explicit failure — we never guess a rate and we never
 * silently add two currencies together.
 */
export function convertToBase(
  amount: DecimalInput,
  fromCurrency: string,
  baseCurrency: string,
  rate: DecimalInput | null | undefined,
): Decimal {
  const from = assertCurrencyCode(fromCurrency);
  const base = assertCurrencyCode(baseCurrency);
  if (from === base) return roundToCurrency(amount, base);

  if (rate === null || rate === undefined) {
    throw currencyMismatch(
      `Cannot convert ${from} to ${base}: no exchange rate recorded for this record`,
      { from, to: base },
    );
  }
  const r = toDecimal(rate);
  if (r.lessThanOrEqualTo(0)) {
    throw unprocessable(`Exchange rate ${from}->${base} must be greater than zero`);
  }
  return roundToCurrency(toDecimal(amount).times(r), base);
}

/**
 * Splits an amount by percentages without losing or inventing a single minor unit.
 *
 * Largest-remainder method: each share is floored to the currency's minor unit,
 * then the leftover minor units are handed out one at a time to the largest
 * remainders. The returned shares always sum exactly to `total`.
 */
export function splitByPercentages(
  total: DecimalInput,
  percentages: { key: string; percentage: DecimalInput }[],
  currency: string,
): { key: string; amount: Decimal }[] {
  const amount = toDecimal(total);
  const places = minorUnits(currency);
  const unit = new Decimal(10).pow(-places);

  const pctTotal = sum(percentages.map((p) => p.percentage));
  if (!pctTotal.equals(100)) {
    throw unprocessable(`Profit share percentages must total exactly 100, received ${pctTotal.toString()}`);
  }

  const raw = percentages.map((p) => {
    const exact = amount.times(toDecimal(p.percentage)).dividedBy(100);
    const floored = exact.toDecimalPlaces(places, Decimal.ROUND_DOWN);
    return { key: p.key, floored, remainder: exact.minus(floored) };
  });

  const distributed = raw.reduce<Decimal>((acc, r) => acc.plus(r.floored), ZERO);
  let leftoverUnits = amount
    .minus(distributed)
    .dividedBy(unit)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  // Negative totals (a loss) distribute the leftover from the smallest remainder up.
  const order = [...raw].sort((a, b) =>
    leftoverUnits >= 0 ? b.remainder.comparedTo(a.remainder) : a.remainder.comparedTo(b.remainder),
  );

  const bump = leftoverUnits >= 0 ? unit : unit.negated();
  let i = 0;
  while (leftoverUnits !== 0 && order.length > 0) {
    const target = order[i % order.length]!;
    target.floored = target.floored.plus(bump);
    leftoverUnits += leftoverUnits > 0 ? -1 : 1;
    i += 1;
  }

  const byKey = new Map(raw.map((r) => [r.key, r.floored]));
  return percentages.map((p) => ({ key: p.key, amount: byKey.get(p.key) ?? ZERO }));
}

export function formatMoney(value: DecimalInput, currency: string, locale = 'en-IN'): string {
  const code = assertCurrencyCode(currency);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: minorUnits(code),
    maximumFractionDigits: minorUnits(code),
  }).format(roundToCurrency(value, code).toNumber());
}
