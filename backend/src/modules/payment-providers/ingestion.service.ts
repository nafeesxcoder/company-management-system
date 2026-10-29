import { prisma } from '../../config/prisma.js';
import type { Db } from '../../config/prisma.js';
import { toDecimal } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import { recordAudit } from '../../services/audit.service.js';
import { statusAfterRefund } from '../reports/calculations.js';

/**
 * Financial ingestion from verified provider events.
 *
 * Design rules, in order of importance:
 *
 * 1. IDEMPOTENCY. Providers retry. Every event is recorded by its provider
 *    event id under a unique constraint, so a replayed delivery is a no-op
 *    instead of duplicated revenue.
 *
 * 2. NEVER GUESS A PROJECT. A payment is attributed only through a trusted
 *    server-side mapping (a registered provider product) or a subscription
 *    record we already own. If neither resolves, the transaction is still
 *    recorded — money did arrive — but flagged NEEDS_REVIEW with no project
 *    rather than being attributed to an arbitrary one.
 *
 * 3. RECORD, THEN PROCESS. The raw event is persisted before any business
 *    logic runs, so a crash mid-processing leaves evidence and can be retried.
 */

export interface NormalizedPaymentEvent {
  provider: 'STRIPE' | 'RAZORPAY' | 'GOOGLE_PLAY' | 'MANUAL_BANK' | 'OTHER';
  externalEventId: string;
  eventType: string;
  kind: 'payment' | 'refund' | 'subscription' | 'unhandled';

  externalTransactionId?: string;
  externalRefundId?: string;
  externalSubscriptionId?: string;
  /** Provider product / price / plan id, used for project attribution. */
  externalProductId?: string;

  grossAmount?: string;
  feeAmount?: string;
  refundAmount?: string;
  currency?: string;

  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  customerReference?: string;
  description?: string;
  occurredAt?: Date;
  subscriptionStatus?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  raw: unknown;
}

export type IngestionOutcome =
  | { status: 'DUPLICATE'; webhookEventId: string; message: string }
  | { status: 'PROCESSED'; webhookEventId: string; transactionId?: string; refundId?: string; needsReview: boolean }
  | { status: 'IGNORED'; webhookEventId: string; message: string }
  | { status: 'FAILED'; webhookEventId: string; message: string };

/**
 * Records the raw event. The unique (provider, externalEventId) constraint is
 * what makes this the idempotency gate — a duplicate delivery fails the insert
 * and we return early without touching any financial record.
 */
export async function recordWebhookEvent(params: {
  providerAccountId: string | null;
  provider: NormalizedPaymentEvent['provider'];
  externalEventId: string;
  eventType: string;
  signatureValid: boolean;
  payload: unknown;
}): Promise<{ id: string; isDuplicate: boolean }> {
  /**
   * Fast path: look first.
   *
   * Provider retries are routine, not exceptional. Relying solely on the
   * unique-constraint violation would log a database error on every ordinary
   * retry, training whoever reads the logs to ignore real errors. The
   * constraint is still the authority — the catch below handles the genuine
   * race where two deliveries arrive at once.
   */
  const alreadySeen = await prisma.webhookEvent.findUnique({
    where: {
      provider_externalEventId: {
        provider: params.provider,
        externalEventId: params.externalEventId,
      },
    },
    select: { id: true },
  });

  if (alreadySeen) {
    logger.info(
      { provider: params.provider, externalEventId: params.externalEventId },
      'Ignoring a webhook event that has already been recorded',
    );
    return { id: alreadySeen.id, isDuplicate: true };
  }

  try {
    const event = await prisma.webhookEvent.create({
      data: {
        providerAccountId: params.providerAccountId,
        provider: params.provider,
        externalEventId: params.externalEventId,
        eventType: params.eventType,
        signatureValid: params.signatureValid,
        status: 'RECEIVED',
        payload: params.payload as never,
      },
      select: { id: true },
    });
    return { id: event.id, isDuplicate: false };
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          provider_externalEventId: {
            provider: params.provider,
            externalEventId: params.externalEventId,
          },
        },
        select: { id: true },
      });
      return { id: existing?.id ?? 'unknown', isDuplicate: true };
    }
    throw error;
  }
}

/**
 * Resolves the project for an incoming payment, using only trusted sources.
 * Returns null when attribution is not certain — the caller then flags the
 * transaction for human review.
 */
async function resolveProject(
  db: Db,
  params: {
    companyId: string;
    providerAccountId: string;
    externalProductId?: string;
    externalSubscriptionId?: string;
  },
): Promise<{ projectId: string | null; reason: string }> {
  // 1. A subscription we already own is the strongest signal.
  if (params.externalSubscriptionId) {
    const subscription = await db.subscription.findFirst({
      where: {
        companyId: params.companyId,
        externalSubscriptionId: params.externalSubscriptionId,
      },
      select: { projectId: true },
    });
    if (subscription?.projectId) {
      return { projectId: subscription.projectId, reason: 'matched existing subscription' };
    }
  }

  // 2. A registered product mapping, configured by an admin in this system.
  if (params.externalProductId) {
    const mapping = await db.providerProductMapping.findFirst({
      where: {
        providerAccountId: params.providerAccountId,
        externalProductId: params.externalProductId,
        isActive: true,
      },
      select: { projectId: true },
    });
    if (mapping) {
      return { projectId: mapping.projectId, reason: 'matched registered product mapping' };
    }
  }

  // 3. Deliberately no fallback. Guessing would silently misattribute revenue.
  return {
    projectId: null,
    reason: params.externalProductId
      ? `no project mapping registered for product "${params.externalProductId}"`
      : 'event carried no product or subscription identifier',
  };
}

/** Processes a verified, non-duplicate event into financial records. */
export async function processPaymentEvent(params: {
  companyId: string;
  providerAccountId: string;
  webhookEventId: string;
  event: NormalizedPaymentEvent;
}): Promise<IngestionOutcome> {
  const { companyId, providerAccountId, webhookEventId, event } = params;

  try {
    if (event.kind === 'unhandled') {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'IGNORED', processedAt: new Date() },
      });
      return {
        status: 'IGNORED',
        webhookEventId,
        message: `Event type "${event.eventType}" is not one this system acts on`,
      };
    }

    if (event.kind === 'refund') {
      return await processRefundEvent({ companyId, webhookEventId, event });
    }

    if (event.kind === 'payment') {
      return await processPayment({ companyId, providerAccountId, webhookEventId, event });
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'IGNORED', processedAt: new Date() },
    });
    return { status: 'IGNORED', webhookEventId, message: 'Subscription lifecycle event recorded only' };
  } catch (error) {
    logger.error({ err: error, webhookEventId }, 'Failed to process webhook event');

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message.slice(0, 2000) : String(error),
        // Exponential-ish backoff for the retry sweeper.
        nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return {
      status: 'FAILED',
      webhookEventId,
      message: error instanceof Error ? error.message : 'Unknown processing error',
    };
  }
}

async function processPayment(params: {
  companyId: string;
  providerAccountId: string;
  webhookEventId: string;
  event: NormalizedPaymentEvent;
}): Promise<IngestionOutcome> {
  const { companyId, providerAccountId, webhookEventId, event } = params;

  if (!event.externalTransactionId || !event.grossAmount || !event.currency) {
    throw new Error('Payment event is missing a transaction id, amount or currency');
  }

  return prisma.$transaction(async (tx) => {
    // Second idempotency gate: the payment itself may arrive under more than
    // one event id (e.g. both `payment_intent.succeeded` and `charge.succeeded`).
    const existing = await tx.transaction.findUnique({
      where: {
        provider_externalTransactionId: {
          provider: event.provider,
          externalTransactionId: event.externalTransactionId!,
        },
      },
      select: { id: true },
    });

    if (existing) {
      await tx.webhookEvent.update({
        where: { id: webhookEventId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return {
        status: 'DUPLICATE' as const,
        webhookEventId,
        message: `Payment ${event.externalTransactionId} is already recorded`,
      };
    }

    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { baseCurrency: true },
    });

    const attribution = await resolveProject(tx, {
      companyId,
      providerAccountId,
      ...(event.externalProductId ? { externalProductId: event.externalProductId } : {}),
      ...(event.externalSubscriptionId ? { externalSubscriptionId: event.externalSubscriptionId } : {}),
    });

    const needsReview = attribution.projectId === null;

    // A foreign-currency payment with no rate still gets recorded — the money
    // is real — but the dashboard will report it as unconverted rather than
    // folding an unconverted figure into a total.
    const sameCurrency = event.currency === company?.baseCurrency;

    const transaction = await tx.transaction.create({
      data: {
        companyId,
        projectId: attribution.projectId,
        providerAccountId,
        provider: event.provider,
        externalTransactionId: event.externalTransactionId!,
        type: event.externalSubscriptionId ? 'SUBSCRIPTION_RENEWAL' : 'ONE_TIME_PAYMENT',
        status: event.status ?? 'SUCCEEDED',
        grossAmount: event.grossAmount!,
        feeAmount: event.feeAmount ?? '0',
        currency: event.currency!,
        exchangeRateToBase: sameCurrency ? null : null,
        customerReference: event.customerReference ?? null,
        description: event.description ?? null,
        occurredAt: event.occurredAt ?? new Date(),
        source: 'AUTOMATED',
        reviewStatus: needsReview ? 'NEEDS_REVIEW' : 'NOT_REQUIRED',
        reviewNote: needsReview
          ? `Automatic attribution failed: ${attribution.reason}. Assign this payment to a project.`
          : null,
        metadata: event.raw as never,
      },
      select: { id: true },
    });

    await tx.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: needsReview ? 'NEEDS_REVIEW' : 'PROCESSED', processedAt: new Date() },
    });

    await recordAudit(
      {
        companyId,
        actorId: null, // system-generated
        action: 'webhook.processed',
        entityType: 'Transaction',
        entityId: transaction.id,
        summary:
          `Ingested ${event.provider} payment ${event.externalTransactionId} ` +
          `(${event.currency} ${event.grossAmount}) — ${attribution.reason}`,
        after: { projectId: attribution.projectId, needsReview },
      },
      tx,
    );

    if (needsReview) {
      // Tell every admin, because unattributed revenue silently skews
      // per-project reporting until someone resolves it.
      const admins = await tx.companyMembership.findMany({
        where: { companyId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { userId: true },
      });

      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            companyId,
            userId: a.userId,
            type: 'WEBHOOK_NEEDS_REVIEW' as const,
            title: 'A payment needs to be assigned to a project',
            body: `${event.provider} payment of ${event.currency} ${event.grossAmount}: ${attribution.reason}`,
            link: `/transactions/${transaction.id}`,
          })),
        });
      }
    }

    return {
      status: 'PROCESSED' as const,
      webhookEventId,
      transactionId: transaction.id,
      needsReview,
    };
  });
}

async function processRefundEvent(params: {
  companyId: string;
  webhookEventId: string;
  event: NormalizedPaymentEvent;
}): Promise<IngestionOutcome> {
  const { companyId, webhookEventId, event } = params;

  if (!event.externalTransactionId || !event.refundAmount) {
    throw new Error('Refund event is missing the original transaction id or the refund amount');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM transactions WHERE provider = ${event.provider} AND externalTransactionId = ${event.externalTransactionId} FOR UPDATE`;

    const transaction = await tx.transaction.findFirst({
      where: {
        companyId,
        provider: event.provider,
        externalTransactionId: event.externalTransactionId!,
      },
      select: {
        id: true,
        grossAmount: true,
        refundedAmount: true,
        currency: true,
        status: true,
      },
    });

    if (!transaction) {
      // The refund arrived before (or without) the payment it belongs to.
      await tx.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'NEEDS_REVIEW',
          lastError: `No recorded transaction for ${event.provider} payment ${event.externalTransactionId}`,
          processedAt: new Date(),
        },
      });
      return {
        status: 'IGNORED' as const,
        webhookEventId,
        message: `Refund references payment ${event.externalTransactionId}, which is not recorded here`,
      };
    }

    if (event.externalRefundId) {
      const duplicate = await tx.refund.findUnique({
        where: {
          provider_externalRefundId: {
            provider: event.provider,
            externalRefundId: event.externalRefundId,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        await tx.webhookEvent.update({
          where: { id: webhookEventId },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
        return {
          status: 'DUPLICATE' as const,
          webhookEventId,
          message: `Refund ${event.externalRefundId} is already recorded`,
        };
      }
    }

    const gross = toDecimal(transaction.grossAmount as never);
    const already = toDecimal(transaction.refundedAmount as never);
    const amount = toDecimal(event.refundAmount!);

    // The provider is the source of truth for what it actually refunded, so we
    // clamp rather than reject — but we record the discrepancy for review.
    const remaining = gross.minus(already);
    const applied = amount.greaterThan(remaining) ? remaining : amount;
    const overRefund = amount.greaterThan(remaining);

    const refund = await tx.refund.create({
      data: {
        transactionId: transaction.id,
        provider: event.provider,
        externalRefundId: event.externalRefundId ?? null,
        amount: applied.toFixed(4),
        currency: transaction.currency,
        status: 'SUCCEEDED',
        isPartial: already.plus(applied).lessThan(gross),
        reason: event.description ?? null,
        source: 'AUTOMATED',
        occurredAt: event.occurredAt ?? new Date(),
      },
      select: { id: true },
    });

    const newTotal = already.plus(applied);
    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        refundedAmount: newTotal.toFixed(4),
        status: statusAfterRefund(gross, newTotal, transaction.status as never) as never,
      },
    });

    await tx.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: overRefund ? 'NEEDS_REVIEW' : 'PROCESSED',
        processedAt: new Date(),
        ...(overRefund
          ? {
              lastError: `Provider reported a refund of ${amount.toString()} but only ${remaining.toString()} remained; recorded the remainder.`,
            }
          : {}),
      },
    });

    await recordAudit(
      {
        companyId,
        actorId: null,
        action: 'webhook.processed',
        entityType: 'Refund',
        entityId: refund.id,
        summary: `Ingested ${event.provider} refund of ${transaction.currency} ${applied.toString()}`,
      },
      tx,
    );

    return {
      status: 'PROCESSED' as const,
      webhookEventId,
      refundId: refund.id,
      needsReview: overRefund,
    };
  });
}
