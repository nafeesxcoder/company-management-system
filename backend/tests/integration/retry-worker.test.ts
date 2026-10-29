import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import {
  MAX_ATTEMPTS,
  backoffFor,
  runRetrySweep,
} from '../../src/modules/payment-providers/retry-worker.js';
import { encryptSecret } from '../../src/utils/crypto.js';
import { resetDatabase, seedTestCompany, type SeededCompany } from '../helpers/fixtures.js';

/**
 * A webhook that verified but failed to PROCESS has already been answered 200,
 * so the provider will never resend it. Without the sweeper that payment is
 * lost: the money exists at the provider and not here. These tests are about
 * that recovery actually happening — and about it not double-counting.
 */

let seeded: SeededCompany;
let accountId: string;

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedTestCompany();

  const account = await prisma.paymentProviderAccount.create({
    data: {
      companyId: seeded.companyId,
      provider: 'STRIPE',
      label: 'Stripe Retry Test',
      webhookSecretCiphertext: encryptSecret('whsec_retry_test_secret_000000'),
    },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A verified-but-unprocessed Stripe charge, parked as FAILED and due now. */
async function failedEvent(overrides: {
  attempts?: number;
  nextRetryAt?: Date | null;
  productId?: string;
  amount?: number;
  signatureValid?: boolean;
  providerAccountId?: string | null;
} = {}) {
  const chargeId = `ch_${Math.random().toString(36).slice(2)}`;
  return prisma.webhookEvent.create({
    data: {
      providerAccountId:
        overrides.providerAccountId === undefined ? accountId : overrides.providerAccountId,
      provider: 'STRIPE',
      externalEventId: `evt_${Math.random().toString(36).slice(2)}`,
      eventType: 'charge.succeeded',
      signatureValid: overrides.signatureValid ?? true,
      status: 'FAILED',
      attempts: overrides.attempts ?? 1,
      lastError: 'Database temporarily unavailable',
      nextRetryAt:
        overrides.nextRetryAt === undefined ? new Date(Date.now() - 60_000) : overrides.nextRetryAt,
      payload: {
        id: `evt_${chargeId}`,
        type: 'charge.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: chargeId,
            amount: overrides.amount ?? 199900, // 1999.00 in paise
            currency: 'inr',
            description: 'Pro plan',
            metadata: { product_id: overrides.productId ?? 'price_pro_monthly' },
          },
        },
      },
    },
  });
}

describe('backoffFor', () => {
  it('grows exponentially from five minutes', () => {
    expect(backoffFor(1)).toBe(5 * 60 * 1000);
    expect(backoffFor(2)).toBe(10 * 60 * 1000);
    expect(backoffFor(3)).toBe(20 * 60 * 1000);
  });

  it('caps so a stuck event does not retry a year from now', () => {
    expect(backoffFor(99)).toBe(6 * 60 * 60 * 1000);
  });
});

describe('runRetrySweep', () => {
  it('reprocesses a failed event into a real transaction', async () => {
    const event = await failedEvent();
    expect(await prisma.transaction.count()).toBe(0);

    const result = await runRetrySweep();

    expect(result.claimed).toBe(1);
    expect(result.processed).toBe(1);
    expect(await prisma.transaction.count()).toBe(1);

    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.status).not.toBe('FAILED');
  });

  it('leaves an event alone until its nextRetryAt has passed', async () => {
    await failedEvent({ nextRetryAt: new Date(Date.now() + 60 * 60 * 1000) });

    const result = await runRetrySweep();

    expect(result.claimed).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('never retries an event whose signature failed verification', async () => {
    // A forged request must not be resurrected by the retry path.
    await failedEvent({ signatureValid: false });

    const result = await runRetrySweep();

    expect(result.claimed).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('does not touch an event that already succeeded', async () => {
    const event = await failedEvent();
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    const result = await runRetrySweep();

    expect(result.claimed).toBe(0);
  });

  it('does not double-count when the same payment is swept twice', async () => {
    await failedEvent();

    await runRetrySweep();
    expect(await prisma.transaction.count()).toBe(1);

    // Force it back into the queue as if the first retry had been recorded as
    // failed after the write landed — the unique constraint must absorb it.
    await prisma.webhookEvent.updateMany({
      data: { status: 'FAILED', nextRetryAt: new Date(Date.now() - 60_000), attempts: 2 },
    });
    await runRetrySweep();

    expect(await prisma.transaction.count()).toBe(1);
  });

  it('gives up after MAX_ATTEMPTS and flags the event for review', async () => {
    // No provider account: processing cannot succeed, so this exercises the
    // give-up path rather than looping forever.
    const event = await failedEvent({
      attempts: MAX_ATTEMPTS - 1,
      providerAccountId: null,
    });

    const result = await runRetrySweep();

    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    expect(after.nextRetryAt).toBeNull();
    expect(result.exhausted).toBe(1);
  });

  it('stops considering an event once it is past MAX_ATTEMPTS', async () => {
    await failedEvent({ attempts: MAX_ATTEMPTS });

    const result = await runRetrySweep();

    expect(result.claimed).toBe(0);
  });

  it('reports nothing to do on an empty queue', async () => {
    const result = await runRetrySweep();
    expect(result).toEqual({ claimed: 0, processed: 0, failed: 0, exhausted: 0 });
  });
});
