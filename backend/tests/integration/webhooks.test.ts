import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { encryptSecret, hmacSha256 } from '../../src/utils/crypto.js';
import {
  EMAILS,
  PASSWORDS,
  authHeader,
  loginAs,
  resetDatabase,
  seedTestCompany,
  type SeededCompany,
  type Session,
} from '../helpers/fixtures.js';

/**
 * Webhook endpoints are unauthenticated and create revenue records, so these
 * tests are mostly about what must NOT happen.
 */

const WEBHOOK_SECRET = 'whsec_test_secret_value_1234567890';

let app: Express;
let seeded: SeededCompany;
let owner: Session;
let stripeAccountId: string;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedTestCompany();
  owner = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

  const account = await prisma.paymentProviderAccount.create({
    data: {
      companyId: seeded.companyId,
      provider: 'STRIPE',
      label: 'Stripe Test',
      webhookSecretCiphertext: encryptSecret(WEBHOOK_SECRET),
    },
  });
  stripeAccountId = account.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function stripePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'charge.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: `ch_${Math.random().toString(36).slice(2)}`,
        amount: 199900, // 1999.00 in paise
        currency: 'inr',
        description: 'Pro plan',
        customer: 'cus_test123',
        metadata: { product_id: 'price_pro_monthly' },
        ...((overrides.object as object) ?? {}),
      },
    },
    ...overrides,
  };
}

function sendStripe(payload: unknown, options: { secret?: string; timestamp?: number } = {}) {
  const body = JSON.stringify(payload);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = hmacSha256(options.secret ?? WEBHOOK_SECRET, `${timestamp}.${body}`);

  return request(app)
    .post(`/api/v1/webhooks/stripe/${stripeAccountId}`)
    .set('Content-Type', 'application/json')
    .set('stripe-signature', `t=${timestamp},v1=${signature}`)
    .send(body);
}

describe('signature verification', () => {
  it('rejects a payload with no signature header', async () => {
    const res = await request(app)
      .post(`/api/v1/webhooks/stripe/${stripeAccountId}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(stripePayload()));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const res = await sendStripe(stripePayload(), { secret: 'whsec_attacker_guess_000000000' });

    expect(res.status).toBe(400);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects a tampered body even when the signature is well-formed', async () => {
    const original = stripePayload();
    const body = JSON.stringify(original);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = hmacSha256(WEBHOOK_SECRET, `${timestamp}.${body}`);

    // Signed the original, then inflated the amount before sending.
    const tampered = JSON.parse(body);
    tampered.data.object.amount = 99999900;

    const res = await request(app)
      .post(`/api/v1/webhooks/stripe/${stripeAccountId}`)
      .set('Content-Type', 'application/json')
      .set('stripe-signature', `t=${timestamp},v1=${signature}`)
      .send(JSON.stringify(tampered));

    expect(res.status).toBe(400);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('rejects a replayed request whose timestamp is outside the tolerance', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600; // an hour old
    const res = await sendStripe(stripePayload(), { timestamp: oldTimestamp });

    expect(res.status).toBe(400);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('records a rejection in the audit log so misconfiguration is visible', async () => {
    await sendStripe(stripePayload(), { secret: 'wrong-secret-here-12345678' });

    const log = await prisma.auditLog.findFirst({ where: { action: 'webhook.signature_rejected' } });
    expect(log).not.toBeNull();
    expect(log?.companyId).toBe(seeded.companyId);
  });

  it('accepts a correctly signed event', async () => {
    const res = await sendStripe(stripePayload());

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PROCESSED');
    expect(await prisma.transaction.count()).toBe(1);
  });
});

describe('idempotency', () => {
  it('treats a replayed event id as a no-op', async () => {
    const payload = stripePayload();

    const first = await sendStripe(payload);
    expect(first.body.data.status).toBe('PROCESSED');

    // Providers retry; the same event must not create revenue twice.
    const second = await sendStripe(payload);
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('duplicate');

    expect(await prisma.transaction.count()).toBe(1);
  });

  it('does not double-record a payment that arrives under two event ids', async () => {
    const chargeId = 'ch_same_charge_twice';

    await sendStripe(stripePayload({ id: 'evt_one', object: { id: chargeId } }));
    const second = await sendStripe(stripePayload({ id: 'evt_two', object: { id: chargeId } }));

    expect(second.body.data.status).toBe('DUPLICATE');
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('keeps a log of every delivery, including duplicates', async () => {
    const payload = stripePayload();
    await sendStripe(payload);
    await sendStripe(payload);

    expect(await prisma.webhookEvent.count()).toBe(1); // unique by event id
  });
});

describe('project attribution', () => {
  it('attributes a payment through a registered product mapping', async () => {
    await prisma.providerProductMapping.create({
      data: {
        providerAccountId: stripeAccountId,
        provider: 'STRIPE',
        projectId: seeded.projectId,
        externalProductId: 'price_pro_monthly',
      },
    });

    const res = await sendStripe(stripePayload());

    expect(res.body.data.needsReview).toBe(false);
    const txn = await prisma.transaction.findFirst();
    expect(txn?.projectId).toBe(seeded.projectId);
    expect(txn?.source).toBe('AUTOMATED');
  });

  it('flags for review rather than guessing when no mapping exists', async () => {
    const res = await sendStripe(stripePayload());

    expect(res.body.data.needsReview).toBe(true);

    const txn = await prisma.transaction.findFirst();
    expect(txn?.projectId).toBeNull(); // not attributed to an arbitrary project
    expect(txn?.reviewStatus).toBe('NEEDS_REVIEW');
    expect(txn?.reviewNote).toContain('no project mapping registered');

    // Money is still recorded — it genuinely arrived.
    expect(txn?.grossAmount.toString()).toBe('1999');
  });

  it('notifies admins when a payment needs attribution', async () => {
    await sendStripe(stripePayload());

    const notifications = await prisma.notification.findMany({
      where: { type: 'WEBHOOK_NEEDS_REVIEW' },
    });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.map((n) => n.userId)).toContain(seeded.ownerId);
  });

  it('lets an admin resolve the attribution afterwards', async () => {
    await sendStripe(stripePayload());
    const txn = await prisma.transaction.findFirst();

    const res = await request(app)
      .post(`/api/v1/transactions/${txn!.id}/assign-project`)
      .set(authHeader(owner))
      .send({ projectId: seeded.projectId, note: 'Pro plan belongs to Test Project' });

    expect(res.status).toBe(200);
    expect(res.body.data.projectId).toBe(seeded.projectId);
    expect(res.body.data.reviewStatus).toBe('RESOLVED');
  });
});

describe('amount conversion', () => {
  it('converts Stripe minor units correctly', async () => {
    await sendStripe(stripePayload({ object: { amount: 199900, currency: 'inr' } }));

    const txn = await prisma.transaction.findFirst();
    expect(txn?.grossAmount.toString()).toBe('1999'); // 199900 paise, not 199900 rupees
  });

  it('handles a zero-decimal currency without dividing by 100', async () => {
    await sendStripe(stripePayload({ object: { amount: 5000, currency: 'jpy' } }));

    const txn = await prisma.transaction.findFirst();
    expect(txn?.grossAmount.toString()).toBe('5000'); // JPY has no minor unit
    expect(txn?.currency).toBe('JPY');
  });

  it('handles an amount with an odd number of paise', async () => {
    await sendStripe(stripePayload({ object: { amount: 1, currency: 'inr' } }));

    const txn = await prisma.transaction.findFirst();
    expect(txn?.grossAmount.toString()).toBe('0.01');
  });
});

describe('refund events', () => {
  it('applies a refund to the original transaction', async () => {
    const chargeId = 'ch_to_be_refunded';
    await sendStripe(stripePayload({ object: { id: chargeId, amount: 100000, currency: 'inr' } }));

    const res = await sendStripe({
      id: 'evt_refund_1',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: chargeId,
          currency: 'inr',
          amount_refunded: 40000, // 400.00
          refunds: { data: [{ id: 're_1', amount: 40000, reason: 'requested_by_customer' }] },
        },
      },
    });

    expect(res.body.data.status).toBe('PROCESSED');

    const txn = await prisma.transaction.findFirst({ where: { externalTransactionId: chargeId } });
    expect(txn?.refundedAmount.toString()).toBe('400');
    expect(txn?.status).toBe('PARTIALLY_REFUNDED');
  });

  it('flags a refund whose payment is not recorded here', async () => {
    const res = await sendStripe({
      id: 'evt_orphan_refund',
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'ch_never_seen',
          currency: 'inr',
          amount_refunded: 10000,
          refunds: { data: [{ id: 're_orphan', amount: 10000 }] },
        },
      },
    });

    expect(res.body.data.status).toBe('IGNORED');
    const event = await prisma.webhookEvent.findFirst({ where: { externalEventId: 'evt_orphan_refund' } });
    expect(event?.status).toBe('NEEDS_REVIEW');
  });

  it('does not apply the same refund twice', async () => {
    const chargeId = 'ch_double_refund';
    await sendStripe(stripePayload({ object: { id: chargeId, amount: 100000, currency: 'inr' } }));

    const refundEvent = {
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: chargeId,
          currency: 'inr',
          amount_refunded: 50000,
          refunds: { data: [{ id: 're_same', amount: 50000 }] },
        },
      },
    };

    await sendStripe({ id: 'evt_r1', ...refundEvent });
    await sendStripe({ id: 'evt_r2', ...refundEvent }); // same refund id, new event id

    const txn = await prisma.transaction.findFirst({ where: { externalTransactionId: chargeId } });
    expect(txn?.refundedAmount.toString()).toBe('500'); // not 1000
    expect(await prisma.refund.count()).toBe(1);
  });
});

describe('failed payments', () => {
  it('records a failed payment without counting it as revenue', async () => {
    await sendStripe({
      id: 'evt_failed',
      type: 'charge.failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: { id: 'ch_failed', amount: 500000, currency: 'inr', failure_message: 'Card declined' },
      },
    });

    const txn = await prisma.transaction.findFirst();
    expect(txn?.status).toBe('FAILED');

    const dashboard = await request(app)
      .get('/api/v1/dashboard?preset=allTime')
      .set(authHeader(owner));
    expect(dashboard.body.data.summary.grossRevenue).toBe('0.00');
  });
});

describe('unhandled events', () => {
  it('ignores an event type the system does not act on', async () => {
    const res = await sendStripe({
      id: 'evt_unhandled',
      type: 'customer.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'cus_1' } },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IGNORED');
    expect(await prisma.transaction.count()).toBe(0);
  });
});

describe('provider account management', () => {
  it('never returns a stored secret', async () => {
    const res = await request(app).get('/api/v1/payment-providers').set(authHeader(owner));

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toContain('Ciphertext');
    expect(res.body.data[0].hasWebhookSecret).toBe(true);
  });

  it('reports honest readiness rather than a premature green tick', async () => {
    const before = await request(app).get('/api/v1/payment-providers').set(authHeader(owner));
    expect(before.body.data[0].readiness).toMatchObject({
      credentialsStored: true,
      productMappingsConfigured: false,
      signedEventReceived: false,
      ready: false,
    });

    await prisma.providerProductMapping.create({
      data: {
        providerAccountId: stripeAccountId,
        provider: 'STRIPE',
        projectId: seeded.projectId,
        externalProductId: 'price_pro_monthly',
      },
    });
    await sendStripe(stripePayload());

    const after = await request(app).get('/api/v1/payment-providers').set(authHeader(owner));
    expect(after.body.data[0].readiness.ready).toBe(true);
  });

  it('resets verification when the secret is rotated', async () => {
    await sendStripe(stripePayload());

    await request(app)
      .patch(`/api/v1/payment-providers/${stripeAccountId}`)
      .set(authHeader(owner))
      .send({ webhookSecret: 'whsec_rotated_value_0987654321' });

    const res = await request(app).get('/api/v1/payment-providers').set(authHeader(owner));
    expect(res.body.data[0].isVerified).toBe(false);
  });

  it('stops a PARTNER configuring integrations', async () => {
    const partner = await loginAs(app, EMAILS.partner, PASSWORDS.partner);

    const res = await request(app)
      .post('/api/v1/payment-providers')
      .set(authHeader(partner))
      .send({ provider: 'RAZORPAY', label: 'Sneaky', webhookSecret: 'some-secret-value-123' });

    expect(res.status).toBe(403);
  });

  it('does not let one company post to another company webhook URL and have it land in their books', async () => {
    // The URL carries the account id, which belongs to a specific company.
    // A correctly signed event lands in THAT company's books, never the caller's.
    await sendStripe(stripePayload());

    const rivalTxnCount = await prisma.transaction.count({
      where: { companyId: seeded.otherCompanyId },
    });
    expect(rivalTxnCount).toBe(0);
  });
});
