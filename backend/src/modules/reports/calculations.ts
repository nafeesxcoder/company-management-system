import { Decimal, ZERO, convertToBase, sum, toDecimal, type DecimalInput } from '../../utils/money.js';

/**
 * THE financial definitions for this system.
 *
 * These are pure functions. The web dashboard, the Flutter app and every CSV
 * export read the result of these functions through the API — no client
 * re-implements any of this, so every surface shows the same number.
 *
 * ---------------------------------------------------------------------------
 * DEFINITIONS
 * ---------------------------------------------------------------------------
 *   Gross Revenue      Σ gross of transactions whose money actually arrived.
 *                      Statuses: SUCCEEDED, PARTIALLY_REFUNDED, REFUNDED.
 *                      PENDING / FAILED / CANCELED / DISPUTED are excluded.
 *
 *   Total Refunds      Σ amount of refunds in status SUCCEEDED only.
 *
 *   Net Revenue        Gross Revenue − Total Refunds.
 *
 *   Processing Fees    Σ transaction.feeAmount (received transactions)
 *                      − Σ refund.feeRefunded (settled refunds).
 *                      Fees are held on the transaction row, so they are
 *                      deducted EXACTLY ONCE. An expense row that also records
 *                      a gateway fee must set excludeFromProfit = true.
 *
 *   Eligible Expenses  Σ (amount + taxAmount) of expenses that are not
 *                      CANCELED and not flagged excludeFromProfit.
 *                      Accrual basis: PENDING and OVERDUE are included because
 *                      the cost has been incurred. `unpaidExpenses` reports the
 *                      cash-flow view separately.
 *
 *   Net Profit         Net Revenue − Processing Fees − Eligible Expenses.
 *
 *   Pending Payments   Σ gross of PENDING transactions. These are outstanding
 *                      receivables and are NEVER counted as revenue.
 *
 * Every figure is expressed in the company's base currency. A record in another
 * currency with no recorded exchange rate is NOT silently added — it is counted
 * in `unconvertedRecords` and excluded, so a total is never quietly wrong.
 * ---------------------------------------------------------------------------
 */

export const RECEIVED_TRANSACTION_STATUSES = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export const PENDING_TRANSACTION_STATUSES = ['PENDING'] as const;
export const EXCLUDED_TRANSACTION_STATUSES = ['FAILED', 'CANCELED'] as const;

export type TransactionStatusLike =
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED';

export type ExpenseStatusLike = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';

export interface TransactionLike {
  id?: string;
  projectId?: string | null;
  provider?: string;
  status: TransactionStatusLike;
  grossAmount: unknown;
  feeAmount: unknown;
  refundedAmount?: unknown;
  currency: string;
  exchangeRateToBase?: unknown | null;
  occurredAt?: Date;
}

export interface RefundLike {
  id?: string;
  transactionId?: string;
  projectId?: string | null;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  amount: unknown;
  feeRefunded?: unknown;
  currency: string;
  exchangeRateToBase?: unknown | null;
  occurredAt?: Date;
}

export interface ExpenseLike {
  id?: string;
  projectId?: string | null;
  categoryId?: string;
  paymentStatus: ExpenseStatusLike;
  excludeFromProfit?: boolean;
  amount: unknown;
  taxAmount?: unknown;
  currency: string;
  exchangeRateToBase?: unknown | null;
  expenseDate?: Date;
}

export interface FinancialTotals {
  currency: string;
  grossRevenue: Decimal;
  totalRefunds: Decimal;
  netRevenue: Decimal;
  processingFees: Decimal;
  totalExpenses: Decimal;
  eligibleExpenses: Decimal;
  unpaidExpenses: Decimal;
  netProfit: Decimal;
  pendingPayments: Decimal;
  disputedAmount: Decimal;
  transactionCount: number;
  refundCount: number;
  expenseCount: number;
  /** Records skipped because they are in another currency with no recorded rate. */
  unconvertedRecords: number;
}

export function isReceived(status: TransactionStatusLike): boolean {
  return (RECEIVED_TRANSACTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Converts a record to base currency, or returns null when it cannot be
 * converted. Returning null (rather than throwing) lets an aggregate report
 * the problem instead of failing the whole dashboard.
 */
function toBaseOrNull(
  amount: unknown,
  currency: string,
  baseCurrency: string,
  rate: unknown | null | undefined,
): Decimal | null {
  try {
    return convertToBase(amount as never, currency, baseCurrency, rate as never);
  } catch {
    return null;
  }
}

export function calculateTotals(
  input: {
    transactions: TransactionLike[];
    refunds: RefundLike[];
    expenses: ExpenseLike[];
  },
  baseCurrency: string,
): FinancialTotals {
  let grossRevenue = ZERO;
  let processingFeesGross = ZERO;
  let pendingPayments = ZERO;
  let disputedAmount = ZERO;
  let unconverted = 0;

  for (const t of input.transactions) {
    const gross = toBaseOrNull(t.grossAmount, t.currency, baseCurrency, t.exchangeRateToBase);
    if (gross === null) {
      unconverted += 1;
      continue;
    }

    if (isReceived(t.status)) {
      grossRevenue = grossRevenue.plus(gross);
      const fee = toBaseOrNull(t.feeAmount ?? 0, t.currency, baseCurrency, t.exchangeRateToBase);
      processingFeesGross = processingFeesGross.plus(fee ?? ZERO);
    } else if (t.status === 'PENDING') {
      pendingPayments = pendingPayments.plus(gross);
    } else if (t.status === 'DISPUTED') {
      disputedAmount = disputedAmount.plus(gross);
    }
    // FAILED and CANCELED contribute nothing, by definition.
  }

  let totalRefunds = ZERO;
  let feesReturned = ZERO;
  let refundCount = 0;

  for (const r of input.refunds) {
    if (r.status !== 'SUCCEEDED') continue;
    const amount = toBaseOrNull(r.amount, r.currency, baseCurrency, r.exchangeRateToBase);
    if (amount === null) {
      unconverted += 1;
      continue;
    }
    totalRefunds = totalRefunds.plus(amount);
    const feeBack = toBaseOrNull(r.feeRefunded ?? 0, r.currency, baseCurrency, r.exchangeRateToBase);
    feesReturned = feesReturned.plus(feeBack ?? ZERO);
    refundCount += 1;
  }

  let totalExpenses = ZERO;
  let eligibleExpenses = ZERO;
  let unpaidExpenses = ZERO;
  let expenseCount = 0;

  for (const e of input.expenses) {
    if (e.paymentStatus === 'CANCELED') continue;
    const base = toBaseOrNull(e.amount, e.currency, baseCurrency, e.exchangeRateToBase);
    const tax = toBaseOrNull(e.taxAmount ?? 0, e.currency, baseCurrency, e.exchangeRateToBase);
    if (base === null) {
      unconverted += 1;
      continue;
    }
    const full = base.plus(tax ?? ZERO);
    totalExpenses = totalExpenses.plus(full);
    expenseCount += 1;

    if (!e.excludeFromProfit) eligibleExpenses = eligibleExpenses.plus(full);
    if (e.paymentStatus === 'PENDING' || e.paymentStatus === 'OVERDUE') {
      unpaidExpenses = unpaidExpenses.plus(full);
    }
  }

  const processingFees = processingFeesGross.minus(feesReturned);
  const netRevenue = grossRevenue.minus(totalRefunds);
  const netProfit = netRevenue.minus(processingFees).minus(eligibleExpenses);

  return {
    currency: baseCurrency,
    grossRevenue,
    totalRefunds,
    netRevenue,
    processingFees,
    totalExpenses,
    eligibleExpenses,
    unpaidExpenses,
    netProfit,
    pendingPayments,
    disputedAmount,
    transactionCount: input.transactions.length,
    refundCount,
    expenseCount,
    unconvertedRecords: unconverted,
  };
}

/** Groups transactions by a key (project, provider, month…) and returns net revenue per group. */
export function groupNetRevenue<T extends TransactionLike>(
  transactions: T[],
  refundsByTransactionId: Map<string, RefundLike[]>,
  keyOf: (t: T) => string,
  baseCurrency: string,
): Map<string, { gross: Decimal; refunds: Decimal; fees: Decimal; net: Decimal; count: number }> {
  const out = new Map<string, { gross: Decimal; refunds: Decimal; fees: Decimal; net: Decimal; count: number }>();

  for (const t of transactions) {
    if (!isReceived(t.status)) continue;
    const gross = toBaseOrNull(t.grossAmount, t.currency, baseCurrency, t.exchangeRateToBase);
    if (gross === null) continue;

    const key = keyOf(t);
    const bucket = out.get(key) ?? { gross: ZERO, refunds: ZERO, fees: ZERO, net: ZERO, count: 0 };

    const fee = toBaseOrNull(t.feeAmount ?? 0, t.currency, baseCurrency, t.exchangeRateToBase) ?? ZERO;

    let refunded = ZERO;
    for (const r of refundsByTransactionId.get(t.id ?? '') ?? []) {
      if (r.status !== 'SUCCEEDED') continue;
      const amt = toBaseOrNull(r.amount, r.currency, baseCurrency, r.exchangeRateToBase);
      if (amt !== null) refunded = refunded.plus(amt);
    }

    bucket.gross = bucket.gross.plus(gross);
    bucket.fees = bucket.fees.plus(fee);
    bucket.refunds = bucket.refunds.plus(refunded);
    bucket.net = bucket.gross.minus(bucket.refunds);
    bucket.count += 1;
    out.set(key, bucket);
  }

  return out;
}

/**
 * How much of a transaction may still be refunded.
 * Guards against over-refunding, which would otherwise create negative revenue.
 */
export function refundableRemainder(grossAmount: DecimalInput, alreadyRefunded: DecimalInput): Decimal {
  const remainder = toDecimal(grossAmount).minus(toDecimal(alreadyRefunded));
  return remainder.isNegative() ? ZERO : remainder;
}

/** Transaction status implied by how much of it has been refunded. */
export function statusAfterRefund(
  grossAmount: DecimalInput,
  totalRefunded: DecimalInput,
  current: TransactionStatusLike,
): TransactionStatusLike {
  const gross = toDecimal(grossAmount);
  const refunded = toDecimal(totalRefunded);
  if (refunded.lessThanOrEqualTo(0)) return current === 'REFUNDED' || current === 'PARTIALLY_REFUNDED' ? 'SUCCEEDED' : current;
  if (refunded.greaterThanOrEqualTo(gross)) return 'REFUNDED';
  return 'PARTIALLY_REFUNDED';
}

export function totalOf(values: unknown[]): Decimal {
  return sum(values as never[]);
}
