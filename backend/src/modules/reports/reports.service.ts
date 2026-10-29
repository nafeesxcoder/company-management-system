import { prisma } from '../../config/prisma.js';
import { Decimal, ZERO, convertToBase, serializeMoney, toDecimal } from '../../utils/money.js';
import { monthKey, monthKeysBetween, type DateRange } from '../../utils/dates.js';
import { calculateTotals, isReceived, type FinancialTotals } from './calculations.js';

/**
 * Dashboard and reporting aggregates.
 *
 * This module is the single authority for every financial figure the product
 * displays. The web dashboard and the Flutter app both render exactly what
 * comes back from here — neither recomputes anything, so the two can never
 * disagree.
 *
 * Every amount leaves as a decimal STRING in the company base currency.
 */

interface RangeArgs {
  companyId: string;
  baseCurrency: string;
  timezone: string;
  range: DateRange;
  projectId?: string;
}

/** Everything the aggregates are computed from, fetched once. */
async function loadFinancialRecords(args: RangeArgs) {
  const { companyId, range, projectId } = args;

  const transactionWhere = {
    companyId,
    ...(projectId ? { projectId } : {}),
    occurredAt: { gte: range.from, lte: range.to },
  };

  const [transactions, refunds, expenses] = await Promise.all([
    prisma.transaction.findMany({
      where: transactionWhere,
      select: {
        id: true,
        projectId: true,
        provider: true,
        status: true,
        grossAmount: true,
        feeAmount: true,
        refundedAmount: true,
        currency: true,
        exchangeRateToBase: true,
        occurredAt: true,
      },
    }),
    prisma.refund.findMany({
      where: {
        transaction: { companyId, ...(projectId ? { projectId } : {}) },
        occurredAt: { gte: range.from, lte: range.to },
      },
      select: {
        id: true,
        transactionId: true,
        status: true,
        amount: true,
        feeRefunded: true,
        currency: true,
        occurredAt: true,
        transaction: { select: { projectId: true, exchangeRateToBase: true } },
      },
    }),
    prisma.expense.findMany({
      where: {
        companyId,
        ...(projectId ? { projectId } : {}),
        expenseDate: { gte: range.from, lte: range.to },
      },
      select: {
        id: true,
        projectId: true,
        categoryId: true,
        paymentStatus: true,
        excludeFromProfit: true,
        amount: true,
        taxAmount: true,
        currency: true,
        exchangeRateToBase: true,
        expenseDate: true,
        category: { select: { id: true, name: true, color: true } },
      },
    }),
  ]);

  // A refund inherits its transaction's rate, so a refund is always converted
  // on the same basis as the payment it reverses.
  const refundsWithRate = refunds.map((r) => ({
    ...r,
    exchangeRateToBase: r.transaction.exchangeRateToBase,
    projectId: r.transaction.projectId,
  }));

  return { transactions, refunds: refundsWithRate, expenses };
}

function serializeTotals(totals: FinancialTotals, currency: string) {
  return {
    currency,
    grossRevenue: serializeMoney(totals.grossRevenue, currency),
    totalRefunds: serializeMoney(totals.totalRefunds, currency),
    netRevenue: serializeMoney(totals.netRevenue, currency),
    processingFees: serializeMoney(totals.processingFees, currency),
    totalExpenses: serializeMoney(totals.totalExpenses, currency),
    eligibleExpenses: serializeMoney(totals.eligibleExpenses, currency),
    unpaidExpenses: serializeMoney(totals.unpaidExpenses, currency),
    netProfit: serializeMoney(totals.netProfit, currency),
    pendingPayments: serializeMoney(totals.pendingPayments, currency),
    disputedAmount: serializeMoney(totals.disputedAmount, currency),
    transactionCount: totals.transactionCount,
    refundCount: totals.refundCount,
    expenseCount: totals.expenseCount,
    unconvertedRecords: totals.unconvertedRecords,
  };
}

function toBaseOrNull(
  amount: unknown,
  currency: string,
  base: string,
  rate: unknown,
): Decimal | null {
  try {
    return convertToBase(amount as never, currency, base, rate as never);
  } catch {
    return null;
  }
}

/**
 * The main dashboard payload: headline totals, breakdowns and a monthly trend.
 */
export async function getDashboard(args: RangeArgs) {
  const { companyId, baseCurrency, timezone, range } = args;
  const { transactions, refunds, expenses } = await loadFinancialRecords(args);

  const totals = calculateTotals(
    { transactions: transactions as never, refunds: refunds as never, expenses: expenses as never },
    baseCurrency,
  );

  // --- Revenue by project ---------------------------------------------------
  const refundsByTransaction = new Map<string, typeof refunds>();
  for (const refund of refunds) {
    const list = refundsByTransaction.get(refund.transactionId) ?? [];
    list.push(refund);
    refundsByTransaction.set(refund.transactionId, list);
  }

  const projectBuckets = new Map<
    string,
    { gross: Decimal; refunds: Decimal; fees: Decimal; expenses: Decimal; count: number }
  >();

  const emptyBucket = () => ({ gross: ZERO, refunds: ZERO, fees: ZERO, expenses: ZERO, count: 0 });
  const UNASSIGNED = '__unassigned__';

  for (const txn of transactions) {
    if (!isReceived(txn.status as never)) continue;
    const gross = toBaseOrNull(txn.grossAmount, txn.currency, baseCurrency, txn.exchangeRateToBase);
    if (gross === null) continue;

    const key = txn.projectId ?? UNASSIGNED;
    const bucket = projectBuckets.get(key) ?? emptyBucket();
    bucket.gross = bucket.gross.plus(gross);
    bucket.fees = bucket.fees.plus(
      toBaseOrNull(txn.feeAmount, txn.currency, baseCurrency, txn.exchangeRateToBase) ?? ZERO,
    );
    bucket.count += 1;

    for (const refund of refundsByTransaction.get(txn.id) ?? []) {
      if (refund.status !== 'SUCCEEDED') continue;
      const amount = toBaseOrNull(refund.amount, refund.currency, baseCurrency, refund.exchangeRateToBase);
      if (amount !== null) bucket.refunds = bucket.refunds.plus(amount);
    }
    projectBuckets.set(key, bucket);
  }

  for (const expense of expenses) {
    if (expense.paymentStatus === 'CANCELED') continue;
    const amount = toBaseOrNull(expense.amount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    const tax = toBaseOrNull(expense.taxAmount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    if (amount === null) continue;

    const key = expense.projectId ?? UNASSIGNED;
    const bucket = projectBuckets.get(key) ?? emptyBucket();
    bucket.expenses = bucket.expenses.plus(amount.plus(tax ?? ZERO));
    projectBuckets.set(key, bucket);
  }

  const projectIds = [...projectBuckets.keys()].filter((k) => k !== UNASSIGNED);
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, companyId },
    select: { id: true, code: true, name: true, type: true, status: true },
  });
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const revenueByProject = [...projectBuckets.entries()]
    .map(([key, bucket]) => {
      const project = projectById.get(key);
      const netRevenue = bucket.gross.minus(bucket.refunds);
      return {
        projectId: key === UNASSIGNED ? null : key,
        code: project?.code ?? (key === UNASSIGNED ? 'UNASSIGNED' : 'UNKNOWN'),
        name: project?.name ?? (key === UNASSIGNED ? 'Awaiting attribution' : 'Removed project'),
        type: project?.type ?? null,
        status: project?.status ?? null,
        grossRevenue: serializeMoney(bucket.gross, baseCurrency),
        refunds: serializeMoney(bucket.refunds, baseCurrency),
        netRevenue: serializeMoney(netRevenue, baseCurrency),
        processingFees: serializeMoney(bucket.fees, baseCurrency),
        expenses: serializeMoney(bucket.expenses, baseCurrency),
        netProfit: serializeMoney(netRevenue.minus(bucket.fees).minus(bucket.expenses), baseCurrency),
        transactionCount: bucket.count,
      };
    })
    .sort((a, b) => Number(b.netRevenue) - Number(a.netRevenue));

  // --- Revenue by provider --------------------------------------------------
  const providerBuckets = new Map<string, { gross: Decimal; fees: Decimal; count: number }>();
  for (const txn of transactions) {
    if (!isReceived(txn.status as never)) continue;
    const gross = toBaseOrNull(txn.grossAmount, txn.currency, baseCurrency, txn.exchangeRateToBase);
    if (gross === null) continue;

    const bucket = providerBuckets.get(txn.provider) ?? { gross: ZERO, fees: ZERO, count: 0 };
    bucket.gross = bucket.gross.plus(gross);
    bucket.fees = bucket.fees.plus(
      toBaseOrNull(txn.feeAmount, txn.currency, baseCurrency, txn.exchangeRateToBase) ?? ZERO,
    );
    bucket.count += 1;
    providerBuckets.set(txn.provider, bucket);
  }

  const revenueByProvider = [...providerBuckets.entries()]
    .map(([provider, b]) => ({
      provider,
      grossRevenue: serializeMoney(b.gross, baseCurrency),
      processingFees: serializeMoney(b.fees, baseCurrency),
      transactionCount: b.count,
    }))
    .sort((a, b) => Number(b.grossRevenue) - Number(a.grossRevenue));

  // --- Expenses by category -------------------------------------------------
  const categoryBuckets = new Map<string, { name: string; color: string | null; total: Decimal; count: number }>();
  for (const expense of expenses) {
    if (expense.paymentStatus === 'CANCELED') continue;
    const amount = toBaseOrNull(expense.amount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    const tax = toBaseOrNull(expense.taxAmount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    if (amount === null) continue;

    const bucket = categoryBuckets.get(expense.categoryId) ?? {
      name: expense.category.name,
      color: expense.category.color,
      total: ZERO,
      count: 0,
    };
    bucket.total = bucket.total.plus(amount.plus(tax ?? ZERO));
    bucket.count += 1;
    categoryBuckets.set(expense.categoryId, bucket);
  }

  const expensesByCategory = [...categoryBuckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      name: b.name,
      color: b.color,
      total: serializeMoney(b.total, baseCurrency),
      count: b.count,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));

  // --- Monthly trend --------------------------------------------------------
  const trend = buildMonthlyTrend({
    transactions,
    refunds,
    expenses,
    baseCurrency,
    timezone,
    range,
  });

  // --- Counts ---------------------------------------------------------------
  const [activeProjects, totalProjects, needsReviewCount, activeSubscriptions] = await Promise.all([
    prisma.project.count({ where: { companyId, status: 'ACTIVE', archivedAt: null } }),
    prisma.project.count({ where: { companyId, archivedAt: null } }),
    prisma.transaction.count({ where: { companyId, reviewStatus: 'NEEDS_REVIEW' } }),
    prisma.subscription.count({ where: { companyId, status: 'ACTIVE' } }),
  ]);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    summary: serializeTotals(totals, baseCurrency),
    counts: {
      activeProjects,
      totalProjects,
      activeSubscriptions,
      transactionsNeedingReview: needsReviewCount,
    },
    revenueByProject,
    revenueByProvider,
    expensesByCategory,
    monthlyTrend: trend,
    /**
     * Set when at least one record could not be converted into the base
     * currency. Clients must surface this — a total that silently drops rows is
     * worse than one that admits it is incomplete.
     */
    dataQuality: {
      unconvertedRecords: totals.unconvertedRecords,
      hasUnconvertedRecords: totals.unconvertedRecords > 0,
      transactionsNeedingReview: needsReviewCount,
    },
  };
}

function buildMonthlyTrend(args: {
  transactions: { status: string; grossAmount: unknown; feeAmount: unknown; currency: string; exchangeRateToBase: unknown; occurredAt: Date }[];
  refunds: { status: string; amount: unknown; currency: string; exchangeRateToBase: unknown; occurredAt: Date }[];
  expenses: { paymentStatus: string; excludeFromProfit: boolean; amount: unknown; taxAmount: unknown; currency: string; exchangeRateToBase: unknown; expenseDate: Date }[];
  baseCurrency: string;
  timezone: string;
  range: DateRange;
}) {
  const { baseCurrency, timezone, range } = args;

  const months = new Map<
    string,
    { gross: Decimal; refunds: Decimal; fees: Decimal; expenses: Decimal }
  >();
  for (const key of monthKeysBetween(range.from, range.to, timezone)) {
    months.set(key, { gross: ZERO, refunds: ZERO, fees: ZERO, expenses: ZERO });
  }

  const bucketFor = (key: string) => {
    const existing = months.get(key);
    if (existing) return existing;
    const fresh = { gross: ZERO, refunds: ZERO, fees: ZERO, expenses: ZERO };
    months.set(key, fresh);
    return fresh;
  };

  for (const txn of args.transactions) {
    if (!isReceived(txn.status as never)) continue;
    const gross = toBaseOrNull(txn.grossAmount, txn.currency, baseCurrency, txn.exchangeRateToBase);
    if (gross === null) continue;
    const bucket = bucketFor(monthKey(txn.occurredAt, timezone));
    bucket.gross = bucket.gross.plus(gross);
    bucket.fees = bucket.fees.plus(
      toBaseOrNull(txn.feeAmount, txn.currency, baseCurrency, txn.exchangeRateToBase) ?? ZERO,
    );
  }

  for (const refund of args.refunds) {
    if (refund.status !== 'SUCCEEDED') continue;
    const amount = toBaseOrNull(refund.amount, refund.currency, baseCurrency, refund.exchangeRateToBase);
    if (amount === null) continue;
    const bucket = bucketFor(monthKey(refund.occurredAt, timezone));
    bucket.refunds = bucket.refunds.plus(amount);
  }

  for (const expense of args.expenses) {
    if (expense.paymentStatus === 'CANCELED' || expense.excludeFromProfit) continue;
    const amount = toBaseOrNull(expense.amount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    const tax = toBaseOrNull(expense.taxAmount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    if (amount === null) continue;
    const bucket = bucketFor(monthKey(expense.expenseDate, timezone));
    bucket.expenses = bucket.expenses.plus(amount.plus(tax ?? ZERO));
  }

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => {
      const netRevenue = b.gross.minus(b.refunds);
      return {
        month,
        grossRevenue: serializeMoney(b.gross, baseCurrency),
        refunds: serializeMoney(b.refunds, baseCurrency),
        netRevenue: serializeMoney(netRevenue, baseCurrency),
        processingFees: serializeMoney(b.fees, baseCurrency),
        expenses: serializeMoney(b.expenses, baseCurrency),
        netProfit: serializeMoney(netRevenue.minus(b.fees).minus(b.expenses), baseCurrency),
      };
    });
}

/** Profit-and-loss statement for a range, with an expense breakdown. */
export async function getProfitLoss(args: RangeArgs) {
  const { baseCurrency, range } = args;
  const { transactions, refunds, expenses } = await loadFinancialRecords(args);

  const totals = calculateTotals(
    { transactions: transactions as never, refunds: refunds as never, expenses: expenses as never },
    baseCurrency,
  );

  const byCategory = new Map<string, { name: string; total: Decimal; eligible: Decimal }>();
  for (const expense of expenses) {
    if (expense.paymentStatus === 'CANCELED') continue;
    const amount = toBaseOrNull(expense.amount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    const tax = toBaseOrNull(expense.taxAmount, expense.currency, baseCurrency, expense.exchangeRateToBase);
    if (amount === null) continue;

    const full = amount.plus(tax ?? ZERO);
    const bucket = byCategory.get(expense.categoryId) ?? {
      name: expense.category.name,
      total: ZERO,
      eligible: ZERO,
    };
    bucket.total = bucket.total.plus(full);
    if (!expense.excludeFromProfit) bucket.eligible = bucket.eligible.plus(full);
    byCategory.set(expense.categoryId, bucket);
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    currency: baseCurrency,
    revenue: {
      grossRevenue: serializeMoney(totals.grossRevenue, baseCurrency),
      refunds: serializeMoney(totals.totalRefunds, baseCurrency),
      netRevenue: serializeMoney(totals.netRevenue, baseCurrency),
    },
    costs: {
      processingFees: serializeMoney(totals.processingFees, baseCurrency),
      eligibleExpenses: serializeMoney(totals.eligibleExpenses, baseCurrency),
      totalExpensesRecorded: serializeMoney(totals.totalExpenses, baseCurrency),
      byCategory: [...byCategory.entries()]
        .map(([categoryId, b]) => ({
          categoryId,
          name: b.name,
          total: serializeMoney(b.total, baseCurrency),
          countedTowardProfit: serializeMoney(b.eligible, baseCurrency),
        }))
        .sort((a, b) => Number(b.total) - Number(a.total)),
    },
    result: {
      netProfit: serializeMoney(totals.netProfit, baseCurrency),
      profitMargin: totals.netRevenue.isZero()
        ? null
        : totals.netProfit.dividedBy(totals.netRevenue).times(100).toDecimalPlaces(2).toString(),
    },
    outstanding: {
      pendingPayments: serializeMoney(totals.pendingPayments, baseCurrency),
      unpaidExpenses: serializeMoney(totals.unpaidExpenses, baseCurrency),
      disputedAmount: serializeMoney(totals.disputedAmount, baseCurrency),
    },
    dataQuality: {
      unconvertedRecords: totals.unconvertedRecords,
      note:
        totals.unconvertedRecords > 0
          ? `${totals.unconvertedRecords} record(s) are in a currency with no recorded exchange rate and are EXCLUDED from these figures.`
          : null,
    },
    /** Spelled out so the numbers can be audited rather than trusted blindly. */
    definitions: {
      netRevenue: 'Gross revenue (received payments) minus settled refunds',
      processingFees: 'Provider fees on received payments, minus fees returned with refunds',
      eligibleExpenses: 'Recorded expenses excluding canceled ones and those flagged excludeFromProfit',
      netProfit: 'Net revenue minus processing fees minus eligible expenses',
      receivedStatuses: 'SUCCEEDED, PARTIALLY_REFUNDED, REFUNDED. PENDING and FAILED are excluded.',
    },
  };
}

/** Rows for the CSV export of transactions. */
export async function getTransactionExportRows(args: RangeArgs) {
  const { companyId, range, projectId, baseCurrency } = args;

  const transactions = await prisma.transaction.findMany({
    where: {
      companyId,
      ...(projectId ? { projectId } : {}),
      occurredAt: { gte: range.from, lte: range.to },
    },
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true,
      occurredAt: true,
      status: true,
      type: true,
      provider: true,
      externalTransactionId: true,
      grossAmount: true,
      feeAmount: true,
      refundedAmount: true,
      currency: true,
      exchangeRateToBase: true,
      customerReference: true,
      description: true,
      source: true,
      reviewStatus: true,
      project: { select: { code: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  return transactions.map((t) => {
    const gross = toDecimal(t.grossAmount as never);
    const fee = toDecimal(t.feeAmount as never);
    const refunded = toDecimal(t.refundedAmount as never);
    const net = gross.minus(refunded).minus(fee);
    const inBase = toBaseOrNull(net, t.currency, baseCurrency, t.exchangeRateToBase);

    return {
      date: t.occurredAt.toISOString(),
      project_code: t.project?.code ?? 'UNASSIGNED',
      project_name: t.project?.name ?? '',
      status: t.status,
      type: t.type,
      provider: t.provider,
      external_id: t.externalTransactionId ?? '',
      gross_amount: gross.toFixed(2),
      fee_amount: fee.toFixed(2),
      refunded_amount: refunded.toFixed(2),
      net_amount: net.toFixed(2),
      currency: t.currency,
      exchange_rate_to_base: t.exchangeRateToBase ? String(t.exchangeRateToBase) : '',
      net_amount_in_base: inBase ? inBase.toFixed(2) : 'NOT_CONVERTED',
      base_currency: baseCurrency,
      customer_reference: t.customerReference ?? '',
      description: t.description ?? '',
      source: t.source,
      review_status: t.reviewStatus,
      recorded_by: t.createdBy?.fullName ?? 'system',
    };
  });
}

/** Rows for the CSV export of expenses. */
export async function getExpenseExportRows(args: RangeArgs) {
  const { companyId, range, projectId, baseCurrency } = args;

  const expenses = await prisma.expense.findMany({
    where: {
      companyId,
      ...(projectId ? { projectId } : {}),
      expenseDate: { gte: range.from, lte: range.to },
    },
    orderBy: { expenseDate: 'asc' },
    select: {
      id: true,
      expenseDate: true,
      vendor: true,
      description: true,
      amount: true,
      taxAmount: true,
      currency: true,
      exchangeRateToBase: true,
      paymentStatus: true,
      excludeFromProfit: true,
      project: { select: { code: true, name: true } },
      category: { select: { name: true } },
      createdBy: { select: { fullName: true } },
    },
  });

  return expenses.map((e) => {
    const amount = toDecimal(e.amount as never);
    const tax = toDecimal(e.taxAmount as never);
    const total = amount.plus(tax);
    const inBase = toBaseOrNull(total, e.currency, baseCurrency, e.exchangeRateToBase);

    return {
      date: e.expenseDate.toISOString().slice(0, 10),
      project_code: e.project?.code ?? 'COMPANY_WIDE',
      project_name: e.project?.name ?? '',
      category: e.category.name,
      vendor: e.vendor,
      description: e.description ?? '',
      amount: amount.toFixed(2),
      tax_amount: tax.toFixed(2),
      total_amount: total.toFixed(2),
      currency: e.currency,
      exchange_rate_to_base: e.exchangeRateToBase ? String(e.exchangeRateToBase) : '',
      total_in_base: inBase ? inBase.toFixed(2) : 'NOT_CONVERTED',
      base_currency: baseCurrency,
      payment_status: e.paymentStatus,
      counted_toward_profit: e.excludeFromProfit ? 'NO' : 'YES',
      recorded_by: e.createdBy?.fullName ?? 'system',
    };
  });
}
