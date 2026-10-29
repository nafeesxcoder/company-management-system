import { prisma } from '../../config/prisma.js';
import { logger } from '../../utils/logger.js';
import {
  normalizeGenericEvent,
  normalizeGooglePlayEvent,
  normalizeRazorpayEvent,
  normalizeStripeEvent,
} from './normalizers.js';
import { processPaymentEvent, type NormalizedPaymentEvent } from './ingestion.service.js';

/**
 * Failed-webhook retry sweeper.
 *
 * A webhook whose signature verified but whose PROCESSING failed (the database
 * was briefly unreachable, a deadlock, a transient bug) has already been
 * answered `200`, so the provider will never send it again. Without this, that
 * payment is simply lost — the money exists at Stripe and does not exist here.
 *
 * `processPaymentEvent` records such an event as FAILED with a `nextRetryAt`.
 * This sweeper is what actually acts on it.
 *
 * Safety:
 *   - Retrying is safe because ingestion is idempotent at the database level:
 *     `(provider, externalTransactionId)` is unique, so a retry that succeeds
 *     partway through a previous attempt cannot double-count revenue.
 *   - Rows are claimed before work starts (status flips to RECEIVED and
 *     `nextRetryAt` is pushed out), so two app instances running the sweeper
 *     will not process the same event twice.
 *   - After MAX_ATTEMPTS the event stops retrying and becomes NEEDS_REVIEW.
 *     Retrying forever would hide a permanent problem behind a quiet loop.
 */

/** Stop retrying after this many failures and ask a human to look. */
export const MAX_ATTEMPTS = 6;

/** 5m, 10m, 20m, 40m, 80m, 160m — capped at 6 hours. */
const BASE_BACKOFF_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 20;

export function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

function renormalize(
  provider: string,
  payload: unknown,
): NormalizedPaymentEvent | null {
  const body = (payload ?? {}) as Record<string, any>;
  switch (provider) {
    case 'STRIPE':
      return normalizeStripeEvent(body);
    case 'RAZORPAY':
      return normalizeRazorpayEvent(body);
    case 'GOOGLE_PLAY':
      return normalizeGooglePlayEvent(body);
    case 'OTHER':
    case 'MANUAL_BANK':
      return normalizeGenericEvent(body);
    default:
      return null;
  }
}

export interface SweepResult {
  claimed: number;
  processed: number;
  failed: number;
  exhausted: number;
}

/**
 * Runs one pass. Exported so it can be invoked from a test or a one-off script
 * rather than only on the timer.
 */
export async function runRetrySweep(now: Date = new Date()): Promise<SweepResult> {
  const due = await prisma.webhookEvent.findMany({
    where: {
      status: 'FAILED',
      signatureValid: true, // never retry something that failed verification
      nextRetryAt: { lte: now },
      attempts: { lt: MAX_ATTEMPTS },
    },
    orderBy: { nextRetryAt: 'asc' },
    take: BATCH_SIZE,
    select: {
      id: true,
      provider: true,
      payload: true,
      attempts: true,
      providerAccountId: true,
      externalEventId: true,
    },
  });

  const result: SweepResult = { claimed: 0, processed: 0, failed: 0, exhausted: 0 };
  if (due.length === 0) return result;

  for (const event of due) {
    // Claim it first: push nextRetryAt out so a second instance sweeping at the
    // same moment does not pick up the same row. `updateMany` with the expected
    // attempts acts as the compare-and-set — if another worker already claimed
    // it, zero rows match and we skip.
    const claim = await prisma.webhookEvent.updateMany({
      where: { id: event.id, status: 'FAILED', attempts: event.attempts },
      data: { nextRetryAt: new Date(now.getTime() + backoffFor(event.attempts + 1)) },
    });
    if (claim.count === 0) continue;
    result.claimed += 1;

    const account = event.providerAccountId
      ? await prisma.paymentProviderAccount.findUnique({
          where: { id: event.providerAccountId },
          select: { id: true, companyId: true },
        })
      : null;

    if (!account) {
      // The provider account was deleted. There is nothing to retry into, and
      // retrying forever would be noise.
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'NEEDS_REVIEW',
          lastError: 'Provider account no longer exists; cannot reprocess',
          nextRetryAt: null,
        },
      });
      result.exhausted += 1;
      continue;
    }

    const normalized = renormalize(event.provider, event.payload);
    if (!normalized) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: 'NEEDS_REVIEW',
          lastError: `No normalizer for provider ${event.provider}`,
          nextRetryAt: null,
        },
      });
      result.exhausted += 1;
      continue;
    }

    const outcome = await processPaymentEvent({
      companyId: account.companyId,
      providerAccountId: account.id,
      webhookEventId: event.id,
      event: normalized,
    });

    if (outcome.status === 'FAILED') {
      const attempts = event.attempts + 1;
      result.failed += 1;

      if (attempts >= MAX_ATTEMPTS) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'NEEDS_REVIEW',
            nextRetryAt: null,
            lastError: `Gave up after ${attempts} attempts. Last error: ${outcome.message}`,
          },
        });
        result.exhausted += 1;
        logger.error(
          { webhookEventId: event.id, externalEventId: event.externalEventId, attempts },
          'Webhook event exhausted its retries and needs manual review',
        );
      } else {
        // processPaymentEvent already incremented attempts and set its own
        // 5-minute nextRetryAt; replace it with the real backoff.
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: { nextRetryAt: new Date(now.getTime() + backoffFor(attempts)) },
        });
      }
    } else {
      result.processed += 1;
      logger.info(
        { webhookEventId: event.id, status: outcome.status },
        'Webhook event reprocessed successfully on retry',
      );
    }
  }

  logger.info(result, 'Webhook retry sweep complete');
  return result;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the periodic sweep. Called from `server.ts`, never from `app.ts`, so
 * that importing the app in a test does not start a background timer.
 */
export function startRetryWorker(): void {
  if (timer) return;

  timer = setInterval(() => {
    void runRetrySweep().catch((error: unknown) => {
      logger.error({ err: error }, 'Webhook retry sweep failed');
    });
  }, SWEEP_INTERVAL_MS);

  // Do not hold the process open on shutdown.
  timer.unref();
  logger.info({ intervalMinutes: SWEEP_INTERVAL_MS / 60000 }, 'Webhook retry worker started');
}

export function stopRetryWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
