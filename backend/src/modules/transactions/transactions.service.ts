import { prisma } from '../../config/prisma.js';
import { conflict, currencyMismatch, notFound, unprocessable } from '../../utils/errors.js';
import { buildOrderBy, toSkipTake } from '../../utils/pagination.js';
import { Decimal, serializeMoney, toDecimal } from '../../utils/money.js';
import { refundableRemainder, statusAfterRefund } from '../reports/calculations.js';
import type {
  CreateRefundInput,
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './transactions.validators.js';

/**
 * Income and payment records.
 *
 * Two invariants hold everywhere in this module:
 *   1. A record in a currency other than the company's base currency MUST carry
 *      an exchange rate, or it cannot be aggregated and is rejected at write
 *      time rather than silently skewing a dashboard later.
 *   2. Refund writes are atomic. The refund row, the running refundedAmount and
 *      the derived status all change inside one database transaction, so a
 *      crash can never leave a transaction claiming a refund total that does
 *      not match its refund rows.
 */

const SORTABLE = ['occurredAt', 'grossAmount', 'createdAt', 'status', 'updatedAt'] as const;

/**
 * Retries a transaction that lost a write-conflict/deadlock race.
 *
 * InnoDB resolves a deadlock by killing one transaction (Prisma surfaces P2034).
 * That victim did nothing wrong, so retrying it with a little jittered backoff
 * is correct — and it keeps a legitimate concurrent refund from failing with a
 * confusing error the user can do nothing about. Application-level rejections
 * (AppError) are NOT retried: those are real answers.
 */
async function withWriteConflictRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as { code?: string }).code;
      const isWriteConflict = code === 'P2034' || code === 'P2037' || code === 'ER_LOCK_DEADLOCK';
      if (!isWriteConflict) throw error;

      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1) + Math.random() * 25));
    }
  }

  throw lastError;
}

const TRANSACTION_SELECT = {
  id: true,
  projectId: true,
  provider: true,
  providerAccountId: true,
  subscriptionId: true,
  externalTransactionId: true,
  type: true,
  status: true,
  grossAmount: true,
  feeAmount: true,
  refundedAmount: true,
  currency: true,
  exchangeRateToBase: true,
  customerReference: true,
  description: true,
  invoiceId: true,
  source: true,
  reviewStatus: true,
  reviewNote: true,
  occurredAt: true,
  settledAt: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true, currency: true } },
  createdBy: { select: { id: true, fullName: true } },
  providerAccount: { select: { id: true, label: true, provider: true } },
} as const;

/**
 * Serialises a transaction for the API: every money field becomes a decimal
 * string and a `netAmount` is included so clients never compute money
 * themselves.
 */
export function serializeTransaction<
  T extends {
    grossAmount: unknown;
    feeAmount: unknown;
    refundedAmount: unknown;
    currency: string;
    exchangeRateToBase?: unknown;
  },
>(txn: T) {
  const gross = toDecimal(txn.grossAmount as never);
  const fee = toDecimal(txn.feeAmount as never);
  const refunded = toDecimal(txn.refundedAmount as never);

  return {
    ...txn,
    grossAmount: serializeMoney(gross, txn.currency),
    feeAmount: serializeMoney(fee, txn.currency),
    refundedAmount: serializeMoney(refunded, txn.currency),
    /** What the business actually keeps from this transaction. */
    netAmount: serializeMoney(gross.minus(refunded).minus(fee), txn.currency),
    refundableRemaining: serializeMoney(refundableRemainder(gross, refunded), txn.currency),
    exchangeRateToBase: txn.exchangeRateToBase ? String(txn.exchangeRateToBase) : null,
  };
}

/** Rejects a foreign-currency record that has no rate to the base currency. */
function assertConvertible(currency: string, baseCurrency: string, rate: string | null | undefined): void {
  if (currency !== baseCurrency && !rate) {
    throw currencyMismatch(
      `A transaction in ${currency} needs "exchangeRateToBase" because the company reports in ${baseCurrency}. ` +
        'Recording it without a rate would make company totals wrong.',
      { currency, baseCurrency },
    );
  }
}

async function assertProjectBelongsToCompany(companyId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: { id: true },
  });
  // 404 rather than 403: never confirm that another company's project exists.
  if (!project) throw notFound('Project');
}

export async function listTransactions(companyId: string, query: ListTransactionsQuery) {
  const { skip, take } = toSkipTake(query);

  const amountFilter =
    query.minAmount || query.maxAmount
      ? {
          grossAmount: {
            ...(query.minAmount ? { gte: query.minAmount } : {}),
            ...(query.maxAmount ? { lte: query.maxAmount } : {}),
          },
        }
      : {};

  const dateFilter =
    query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {};

  const where = {
    companyId,
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...amountFilter,
    ...dateFilter,
    ...(query.search
      ? {
          OR: [
            { description: { contains: query.search } },
            { customerReference: { contains: query.search } },
            { externalTransactionId: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [items, totalItems] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip,
      take,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, 'occurredAt'),
      select: TRANSACTION_SELECT,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { items: items.map(serializeTransaction), totalItems };
}

export async function getTransaction(companyId: string, transactionId: string) {
  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, companyId },
    select: {
      ...TRANSACTION_SELECT,
      refunds: {
        orderBy: { occurredAt: 'desc' },
        select: {
          id: true,
          amount: true,
          feeRefunded: true,
          currency: true,
          status: true,
          isPartial: true,
          reason: true,
          externalRefundId: true,
          source: true,
          occurredAt: true,
          createdAt: true,
          createdBy: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!txn) throw notFound('Transaction');

  return {
    ...serializeTransaction(txn),
    refunds: txn.refunds.map((r) => ({
      ...r,
      amount: serializeMoney(r.amount as never, r.currency),
      feeRefunded: serializeMoney(r.feeRefunded as never, r.currency),
    })),
  };
}

export async function createTransaction(params: {
  companyId: string;
  baseCurrency: string;
  createdById: string;
  input: CreateTransactionInput;
}) {
  const { companyId, baseCurrency, createdById, input } = params;

  await assertProjectBelongsToCompany(companyId, input.projectId);
  assertConvertible(input.currency, baseCurrency, input.exchangeRateToBase);

  // A duplicate provider reference means this payment is already recorded;
  // creating a second row would double-count revenue.
  if (input.externalTransactionId) {
    const existing = await prisma.transaction.findUnique({
      where: {
        provider_externalTransactionId: {
          provider: input.provider,
          externalTransactionId: input.externalTransactionId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      throw conflict(
        `A ${input.provider} transaction with reference "${input.externalTransactionId}" is already recorded`,
        { existingTransactionId: existing.id },
      );
    }
  }

  if (input.subscriptionId) {
    const sub = await prisma.subscription.findFirst({
      where: { id: input.subscriptionId, companyId },
      select: { id: true },
    });
    if (!sub) throw notFound('Subscription');
  }

  if (input.providerAccountId) {
    const account = await prisma.paymentProviderAccount.findFirst({
      where: { id: input.providerAccountId, companyId },
      select: { id: true },
    });
    if (!account) throw notFound('Payment provider account');
  }

  const txn = await prisma.transaction.create({
    data: {
      companyId,
      projectId: input.projectId,
      provider: input.provider,
      providerAccountId: input.providerAccountId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      externalTransactionId: input.externalTransactionId ?? null,
      type: input.type,
      status: input.status,
      grossAmount: input.grossAmount,
      feeAmount: input.feeAmount,
      currency: input.currency,
      exchangeRateToBase: input.exchangeRateToBase ?? null,
      customerReference: input.customerReference ?? null,
      description: input.description ?? null,
      invoiceId: input.invoiceId ?? null,
      occurredAt: new Date(input.occurredAt),
      settledAt: input.settledAt ? new Date(input.settledAt) : null,
      source: 'MANUAL',
      reviewStatus: 'NOT_REQUIRED',
      createdById,
    },
    select: TRANSACTION_SELECT,
  });

  return serializeTransaction(txn);
}

export async function updateTransaction(params: {
  companyId: string;
  baseCurrency: string;
  transactionId: string;
  input: UpdateTransactionInput;
}) {
  const { companyId, baseCurrency, transactionId, input } = params;

  const existing = await prisma.transaction.findFirst({
    where: { id: transactionId, companyId },
    select: TRANSACTION_SELECT,
  });
  if (!existing) throw notFound('Transaction');

  if (input.projectId) await assertProjectBelongsToCompany(companyId, input.projectId);

  const nextCurrency = input.currency ?? existing.currency;
  const nextRate =
    input.exchangeRateToBase !== undefined
      ? input.exchangeRateToBase
      : existing.exchangeRateToBase
        ? String(existing.exchangeRateToBase)
        : null;
  assertConvertible(nextCurrency, baseCurrency, nextRate);

  // Reducing the gross below what has already been refunded would make the
  // transaction self-contradictory.
  if (input.grossAmount) {
    const refunded = toDecimal(existing.refundedAmount as never);
    if (toDecimal(input.grossAmount).lessThan(refunded)) {
      throw unprocessable(
        `Gross amount cannot be less than the ${serializeMoney(refunded, existing.currency)} already refunded`,
      );
    }
  }

  const nextGross = input.grossAmount ?? String(existing.grossAmount);
  const nextFee = input.feeAmount ?? String(existing.feeAmount);
  if (toDecimal(nextFee).greaterThan(toDecimal(nextGross))) {
    throw unprocessable('Fee cannot exceed the gross amount');
  }

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.grossAmount !== undefined ? { grossAmount: input.grossAmount } : {}),
      ...(input.feeAmount !== undefined ? { feeAmount: input.feeAmount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.exchangeRateToBase !== undefined
        ? { exchangeRateToBase: input.exchangeRateToBase ?? null }
        : {}),
      ...(input.customerReference !== undefined
        ? { customerReference: input.customerReference ?? null }
        : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
      ...(input.settledAt !== undefined
        ? { settledAt: input.settledAt ? new Date(input.settledAt) : null }
        : {}),
      ...(input.reviewNote !== undefined ? { reviewNote: input.reviewNote ?? null } : {}),
    },
    select: TRANSACTION_SELECT,
  });

  return { before: serializeTransaction(existing), after: serializeTransaction(updated) };
}

export async function deleteTransaction(companyId: string, transactionId: string) {
  const existing = await prisma.transaction.findFirst({
    where: { id: transactionId, companyId },
    select: { ...TRANSACTION_SELECT, _count: { select: { refunds: true } } },
  });
  if (!existing) throw notFound('Transaction');

  if (existing.source === 'AUTOMATED') {
    throw conflict(
      'This transaction was ingested from a verified payment provider webhook and cannot be deleted. ' +
        'Record a refund instead, so the books continue to match the provider.',
    );
  }

  if (existing._count.refunds > 0) {
    throw conflict(
      `Cannot delete a transaction with ${existing._count.refunds} refund(s) attached. Delete the refunds first.`,
    );
  }

  await prisma.transaction.delete({ where: { id: transactionId } });
  return serializeTransaction(existing);
}

/**
 * Attributes a payment that arrived without a reliable project mapping.
 * Used from the "Needs review" queue.
 */
export async function assignProject(params: {
  companyId: string;
  transactionId: string;
  projectId: string;
  note?: string;
}) {
  const { companyId, transactionId, projectId, note } = params;

  const existing = await prisma.transaction.findFirst({
    where: { id: transactionId, companyId },
    select: TRANSACTION_SELECT,
  });
  if (!existing) throw notFound('Transaction');

  await assertProjectBelongsToCompany(companyId, projectId);

  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: {
      projectId,
      reviewStatus: 'RESOLVED',
      reviewNote: note ?? existing.reviewNote,
    },
    select: TRANSACTION_SELECT,
  });

  return { before: serializeTransaction(existing), after: serializeTransaction(updated) };
}

/**
 * Records a refund ATOMICALLY.
 *
 * Inside one database transaction we re-read the row, verify the refund fits
 * within what is left, insert the refund, and update both the running total and
 * the derived status. Re-reading inside the transaction is what makes two
 * concurrent refunds safe: the second sees the first's committed total.
 */
export async function createRefund(params: {
  companyId: string;
  transactionId: string;
  createdById: string;
  input: CreateRefundInput;
}) {
  const { companyId, transactionId, createdById, input } = params;

  return withWriteConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      /**
       * Take an exclusive row lock BEFORE reading.
       *
       * Without this, two concurrent refunds both read the same
       * `refundedAmount`, both pass the "fits in the remainder" check, and both
       * write — over-refunding the transaction. Worse, under InnoDB the two
       * read-then-write sequences deadlock each other. `FOR UPDATE` serialises
       * them: the second waits, then reads the first's committed total and is
       * correctly rejected if nothing is left.
       */
      await tx.$queryRaw`SELECT id FROM transactions WHERE id = ${transactionId} FOR UPDATE`;

      const txn = await tx.transaction.findFirst({
        where: { id: transactionId, companyId },
        select: {
          id: true,
          provider: true,
          status: true,
          grossAmount: true,
          feeAmount: true,
          refundedAmount: true,
          currency: true,
        },
      });
      if (!txn) throw notFound('Transaction');

    if (txn.status === 'PENDING' || txn.status === 'FAILED' || txn.status === 'CANCELED') {
      throw unprocessable(
        `Cannot refund a transaction with status ${txn.status} — no money was received to refund.`,
      );
    }

    const gross = toDecimal(txn.grossAmount as never);
    const alreadyRefunded = toDecimal(txn.refundedAmount as never);
    const remaining = refundableRemainder(gross, alreadyRefunded);
    const amount = toDecimal(input.amount);

    if (amount.greaterThan(remaining)) {
      throw unprocessable(
        `Refund of ${serializeMoney(amount, txn.currency)} exceeds the ` +
          `${serializeMoney(remaining, txn.currency)} still refundable on this transaction`,
        {
          grossAmount: serializeMoney(gross, txn.currency),
          alreadyRefunded: serializeMoney(alreadyRefunded, txn.currency),
          refundableRemaining: serializeMoney(remaining, txn.currency),
        },
      );
    }

    const feeRefunded = toDecimal(input.feeRefunded ?? '0');
    if (feeRefunded.greaterThan(toDecimal(txn.feeAmount as never))) {
      throw unprocessable('Refunded fee cannot exceed the fee originally charged');
    }

    if (input.externalRefundId) {
      const duplicate = await tx.refund.findUnique({
        where: {
          provider_externalRefundId: {
            provider: txn.provider,
            externalRefundId: input.externalRefundId,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw conflict(`Refund "${input.externalRefundId}" is already recorded`, {
          existingRefundId: duplicate.id,
        });
      }
    }

    const newRefundedTotal = alreadyRefunded.plus(amount);
    const isPartial = newRefundedTotal.lessThan(gross);

    const refund = await tx.refund.create({
      data: {
        transactionId,
        provider: txn.provider,
        externalRefundId: input.externalRefundId ?? null,
        amount: amount.toFixed(4),
        feeRefunded: feeRefunded.toFixed(4),
        currency: txn.currency,
        status: 'SUCCEEDED',
        isPartial,
        reason: input.reason ?? null,
        source: 'MANUAL',
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        createdById,
      },
    });

    const updated = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        refundedAmount: newRefundedTotal.toFixed(4),
        status: statusAfterRefund(gross, newRefundedTotal, txn.status as never) as never,
      },
      select: TRANSACTION_SELECT,
    });

      return {
        refund: {
          ...refund,
          amount: serializeMoney(refund.amount as never, refund.currency),
          feeRefunded: serializeMoney(refund.feeRefunded as never, refund.currency),
        },
        transaction: serializeTransaction(updated),
      };
    }),
  );
}

/** Reverses a refund (recorded in error), restoring the running total atomically. */
export async function deleteRefund(params: { companyId: string; refundId: string }) {
  const { companyId, refundId } = params;

  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findFirst({
      where: { id: refundId, transaction: { companyId } },
      select: {
        id: true,
        amount: true,
        source: true,
        currency: true,
        transactionId: true,
        transaction: { select: { grossAmount: true, refundedAmount: true, status: true } },
      },
    });
    if (!refund) throw notFound('Refund');

    if (refund.source === 'AUTOMATED') {
      throw conflict(
        'This refund came from a verified provider webhook and cannot be deleted — it reflects what the provider actually did.',
      );
    }

    const gross = toDecimal(refund.transaction.grossAmount as never);
    const currentTotal = toDecimal(refund.transaction.refundedAmount as never);
    const restored = Decimal.max(currentTotal.minus(toDecimal(refund.amount as never)), 0);

    await tx.refund.delete({ where: { id: refundId } });

    const updated = await tx.transaction.update({
      where: { id: refund.transactionId },
      data: {
        refundedAmount: restored.toFixed(4),
        status: statusAfterRefund(gross, restored, refund.transaction.status as never) as never,
      },
      select: TRANSACTION_SELECT,
    });

    return { deletedRefundId: refundId, transaction: serializeTransaction(updated) };
  });
}

export async function listRefunds(
  companyId: string,
  query: { page: number; pageSize: number; projectId?: string; from?: string; to?: string },
) {
  const { skip, take } = toSkipTake(query);

  const where = {
    transaction: {
      companyId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
    },
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [items, totalItems] = await Promise.all([
    prisma.refund.findMany({
      where,
      skip,
      take,
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        amount: true,
        feeRefunded: true,
        currency: true,
        status: true,
        isPartial: true,
        reason: true,
        source: true,
        occurredAt: true,
        transaction: {
          select: {
            id: true,
            grossAmount: true,
            currency: true,
            project: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  return {
    items: items.map((r) => ({
      ...r,
      amount: serializeMoney(r.amount as never, r.currency),
      feeRefunded: serializeMoney(r.feeRefunded as never, r.currency),
      transaction: {
        ...r.transaction,
        grossAmount: serializeMoney(r.transaction.grossAmount as never, r.transaction.currency),
      },
    })),
    totalItems,
  };
}
