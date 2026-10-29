import { prisma } from '../../config/prisma.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { Decimal, ZERO, serializeMoney, splitByPercentages, toDecimal } from '../../utils/money.js';
import { toDateOnly, type DateRange } from '../../utils/dates.js';
import { calculateTotals } from '../reports/calculations.js';

/**
 * Partner profit sharing.
 *
 * Two things this module refuses to conflate:
 *
 *   CALCULATED SHARE  what each partner is owed, derived from net profit and
 *                     the configured split.
 *   ACTUAL PAYOUT     money that has actually moved to that partner.
 *
 * They are different numbers and are stored separately. The difference between
 * them — the outstanding distribution — is the figure partners actually care
 * about, and it would be invisible if we treated a calculated share as paid.
 *
 * The split is versioned and effective-dated; it is never hardcoded to 50/50.
 */

export interface ShareConfigInput {
  shares: { userId: string; percentage: string }[];
  effectiveFrom: string;
  note?: string;
}

/** The split in force on a given date. */
export async function getActiveShares(companyId: string, on: Date = new Date()) {
  const date = toDateOnly(on);

  const shares = await prisma.partnerProfitShare.findMany({
    where: {
      companyId,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    select: {
      id: true,
      userId: true,
      percentage: true,
      effectiveFrom: true,
      effectiveTo: true,
      note: true,
      user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
    },
  });

  // Several generations may match; keep only the newest row per partner.
  const latestByUser = new Map<string, (typeof shares)[number]>();
  for (const share of shares) {
    if (!latestByUser.has(share.userId)) latestByUser.set(share.userId, share);
  }

  return [...latestByUser.values()].sort((a, b) =>
    Number(b.percentage.toString()) - Number(a.percentage.toString()),
  );
}

export async function listShareHistory(companyId: string) {
  return prisma.partnerProfitShare.findMany({
    where: { companyId },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      userId: true,
      percentage: true,
      effectiveFrom: true,
      effectiveTo: true,
      note: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, email: true } },
      createdBy: { select: { id: true, fullName: true } },
    },
  });
}

/**
 * Replaces the split from `effectiveFrom` onwards.
 *
 * Percentages must total exactly 100 — validated with Decimal, because
 * 33.33 + 33.33 + 33.34 is only exactly 100 in decimal arithmetic. Earlier
 * configurations are closed off rather than deleted, so historical reports
 * continue to reflect the split that was actually in force at the time.
 */
export async function setShares(params: {
  companyId: string;
  createdById: string;
  input: ShareConfigInput;
}) {
  const { companyId, createdById, input } = params;
  const effectiveFrom = toDateOnly(input.effectiveFrom);

  if (input.shares.length === 0) {
    throw unprocessable('At least one partner share is required');
  }

  const total = input.shares.reduce<Decimal>((acc, s) => acc.plus(toDecimal(s.percentage)), ZERO);
  if (!total.equals(100)) {
    throw unprocessable(
      `Profit share percentages must total exactly 100%, received ${total.toString()}%`,
      { received: total.toString(), shares: input.shares },
    );
  }

  for (const share of input.shares) {
    const pct = toDecimal(share.percentage);
    if (pct.isNegative()) throw unprocessable('A profit share percentage cannot be negative');
    if (pct.greaterThan(100)) throw unprocessable('A profit share percentage cannot exceed 100');
  }

  const userIds = input.shares.map((s) => s.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw unprocessable('Each partner may appear only once in the configuration');
  }

  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, userId: { in: userIds }, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (memberships.length !== userIds.length) {
    throw unprocessable('Every partner in a profit-share configuration must be an active company member');
  }

  return prisma.$transaction(async (tx) => {
    // Close any open configuration that starts before this one.
    await tx.partnerProfitShare.updateMany({
      where: { companyId, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveTo: new Date(effectiveFrom.getTime() - 24 * 60 * 60 * 1000) },
    });

    // Replace any configuration already starting on this exact date.
    await tx.partnerProfitShare.deleteMany({ where: { companyId, effectiveFrom } });

    await tx.partnerProfitShare.createMany({
      data: input.shares.map((s) => ({
        companyId,
        userId: s.userId,
        percentage: s.percentage,
        effectiveFrom,
        createdById,
        note: input.note ?? null,
      })),
    });

    return tx.partnerProfitShare.findMany({
      where: { companyId, effectiveFrom },
      select: {
        id: true,
        userId: true,
        percentage: true,
        effectiveFrom: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
  });
}

/**
 * The profit-sharing statement: calculated share per partner for the period,
 * what has actually been paid, and what remains outstanding.
 */
export async function getProfitShareStatement(params: {
  companyId: string;
  baseCurrency: string;
  range: DateRange;
}) {
  const { companyId, baseCurrency, range } = params;

  const [transactions, refunds, expenses, shares] = await Promise.all([
    prisma.transaction.findMany({
      where: { companyId, occurredAt: { gte: range.from, lte: range.to } },
      select: {
        id: true,
        status: true,
        grossAmount: true,
        feeAmount: true,
        currency: true,
        exchangeRateToBase: true,
      },
    }),
    prisma.refund.findMany({
      where: {
        transaction: { companyId },
        occurredAt: { gte: range.from, lte: range.to },
      },
      select: {
        status: true,
        amount: true,
        feeRefunded: true,
        currency: true,
        transaction: { select: { exchangeRateToBase: true } },
      },
    }),
    prisma.expense.findMany({
      where: { companyId, expenseDate: { gte: range.from, lte: range.to } },
      select: {
        paymentStatus: true,
        excludeFromProfit: true,
        amount: true,
        taxAmount: true,
        currency: true,
        exchangeRateToBase: true,
      },
    }),
    getActiveShares(companyId, range.to),
  ]);

  const totals = calculateTotals(
    {
      transactions: transactions as never,
      refunds: refunds.map((r) => ({
        ...r,
        exchangeRateToBase: r.transaction.exchangeRateToBase,
      })) as never,
      expenses: expenses as never,
    },
    baseCurrency,
  );

  const netProfit = totals.netProfit;

  if (shares.length === 0) {
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      currency: baseCurrency,
      netProfit: serializeMoney(netProfit, baseCurrency),
      configured: false,
      message:
        'No profit-share configuration is in force for this period. Configure the split before distributing profit.',
      partners: [],
    };
  }

  // Largest-remainder split: shares always add back up to net profit exactly,
  // with no stray paisa created or lost.
  const allocation = splitByPercentages(
    netProfit,
    shares.map((s) => ({ key: s.userId, percentage: s.percentage.toString() })),
    baseCurrency,
  );
  const allocationByUser = new Map(allocation.map((a) => [a.key, a.amount]));

  // Payouts recorded for this period. A payout with no period is attributed by
  // its payout date.
  const payouts = await prisma.partnerPayout.findMany({
    where: {
      companyId,
      status: 'PAID',
      userId: { in: shares.map((s) => s.userId) },
      payoutDate: { gte: toDateOnly(range.from), lte: toDateOnly(range.to) },
    },
    select: { userId: true, amount: true, currency: true },
  });

  const paidByUser = new Map<string, Decimal>();
  for (const payout of payouts) {
    // Payouts are recorded in the company base currency by design.
    if (payout.currency !== baseCurrency) continue;
    paidByUser.set(
      payout.userId,
      (paidByUser.get(payout.userId) ?? ZERO).plus(toDecimal(payout.amount as never)),
    );
  }

  const partners = shares.map((share) => {
    const calculated = allocationByUser.get(share.userId) ?? ZERO;
    const paid = paidByUser.get(share.userId) ?? ZERO;
    return {
      userId: share.userId,
      fullName: share.user.fullName,
      email: share.user.email,
      avatarUrl: share.user.avatarUrl,
      percentage: share.percentage.toString(),
      calculatedShare: serializeMoney(calculated, baseCurrency),
      actuallyPaid: serializeMoney(paid, baseCurrency),
      outstanding: serializeMoney(calculated.minus(paid), baseCurrency),
      effectiveFrom: share.effectiveFrom,
    };
  });

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    currency: baseCurrency,
    netProfit: serializeMoney(netProfit, baseCurrency),
    configured: true,
    partners,
    totals: {
      calculated: serializeMoney(
        partners.reduce<Decimal>((acc, p) => acc.plus(toDecimal(p.calculatedShare)), ZERO),
        baseCurrency,
      ),
      paid: serializeMoney(
        partners.reduce<Decimal>((acc, p) => acc.plus(toDecimal(p.actuallyPaid)), ZERO),
        baseCurrency,
      ),
      outstanding: serializeMoney(
        partners.reduce<Decimal>((acc, p) => acc.plus(toDecimal(p.outstanding)), ZERO),
        baseCurrency,
      ),
    },
    note:
      'A calculated share is what a partner is owed, not money that has been paid. ' +
      'Record an actual payout to reduce the outstanding figure.',
    dataQuality: { unconvertedRecords: totals.unconvertedRecords },
  };
}

// --- Payouts ----------------------------------------------------------------

export async function listPayouts(params: {
  companyId: string;
  page: number;
  pageSize: number;
  userId?: string;
}) {
  const { companyId, page, pageSize, userId } = params;
  const where = { companyId, ...(userId ? { userId } : {}) };

  const [items, totalItems] = await Promise.all([
    prisma.partnerPayout.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { payoutDate: 'desc' },
      select: {
        id: true,
        userId: true,
        amount: true,
        currency: true,
        payoutDate: true,
        status: true,
        method: true,
        reference: true,
        notes: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        partner: { select: { id: true, fullName: true, email: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.partnerPayout.count({ where }),
  ]);

  return {
    items: items.map((p) => ({ ...p, amount: serializeMoney(p.amount as never, p.currency) })),
    totalItems,
  };
}

export async function createPayout(params: {
  companyId: string;
  baseCurrency: string;
  createdById: string;
  input: {
    userId: string;
    amount: string;
    currency?: string;
    payoutDate: string;
    method?: string;
    reference?: string;
    notes?: string;
    periodStart?: string;
    periodEnd?: string;
    status?: 'PENDING' | 'PAID' | 'CANCELED';
  };
}) {
  const { companyId, baseCurrency, createdById, input } = params;

  const membership = await prisma.companyMembership.findFirst({
    where: { companyId, userId: input.userId },
    select: { id: true, status: true },
  });
  if (!membership) throw notFound('Partner');

  const currency = (input.currency ?? baseCurrency).toUpperCase();
  if (currency !== baseCurrency) {
    throw unprocessable(
      `Payouts must be recorded in the company base currency (${baseCurrency}) so that ` +
        'outstanding distributions remain comparable to calculated shares.',
    );
  }

  if (toDecimal(input.amount).lessThanOrEqualTo(0)) {
    throw unprocessable('Payout amount must be greater than zero');
  }

  return prisma.partnerPayout.create({
    data: {
      companyId,
      userId: input.userId,
      amount: input.amount,
      currency,
      payoutDate: toDateOnly(input.payoutDate),
      status: input.status ?? 'PAID',
      method: input.method ?? null,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      periodStart: input.periodStart ? toDateOnly(input.periodStart) : null,
      periodEnd: input.periodEnd ? toDateOnly(input.periodEnd) : null,
      createdById,
    },
    select: {
      id: true,
      userId: true,
      amount: true,
      currency: true,
      payoutDate: true,
      status: true,
      method: true,
      reference: true,
      partner: { select: { id: true, fullName: true } },
    },
  });
}

export async function deletePayout(companyId: string, payoutId: string) {
  const existing = await prisma.partnerPayout.findFirst({
    where: { id: payoutId, companyId },
    select: { id: true, amount: true, currency: true, userId: true, payoutDate: true },
  });
  if (!existing) throw notFound('Payout');

  await prisma.partnerPayout.delete({ where: { id: payoutId } });
  return existing;
}

export async function updatePayout(params: {
  companyId: string;
  payoutId: string;
  input: {
    amount?: string;
    payoutDate?: string;
    status?: 'PENDING' | 'PAID' | 'CANCELED';
    method?: string | null;
    reference?: string | null;
    notes?: string | null;
  };
}) {
  const { companyId, payoutId, input } = params;

  const existing = await prisma.partnerPayout.findFirst({
    where: { id: payoutId, companyId },
  });
  if (!existing) throw notFound('Payout');

  if (input.amount && toDecimal(input.amount).lessThanOrEqualTo(0)) {
    throw unprocessable('Payout amount must be greater than zero');
  }

  const updated = await prisma.partnerPayout.update({
    where: { id: payoutId },
    data: {
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.payoutDate !== undefined ? { payoutDate: toDateOnly(input.payoutDate) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return { before: existing, after: updated };
}
