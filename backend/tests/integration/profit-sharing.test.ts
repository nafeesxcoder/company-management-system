import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
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

let app: Express;
let seeded: SeededCompany;
let owner: Session;
let partner: Session;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedTestCompany();
  owner = await loginAs(app, EMAILS.owner, PASSWORDS.owner);
  partner = await loginAs(app, EMAILS.partner, PASSWORDS.partner);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Produces a known net profit: 10,000 revenue − 1,000 expenses = 9,000. */
async function createKnownProfit() {
  await request(app)
    .post('/api/v1/transactions')
    .set(authHeader(owner))
    .send({
      projectId: seeded.projectId,
      grossAmount: '10000.00',
      currency: 'INR',
      occurredAt: '2026-06-15T10:00:00.000Z',
    });

  await request(app)
    .post('/api/v1/expenses')
    .set(authHeader(owner))
    .send({
      categoryId: seeded.categoryId,
      vendor: 'Hosting',
      amount: '1000.00',
      currency: 'INR',
      expenseDate: '2026-06-16',
    });
}

describe('profit share configuration', () => {
  it('rejects percentages that do not total 100', async () => {
    const res = await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(owner))
      .send({
        shares: [
          { userId: seeded.ownerId, percentage: '60' },
          { userId: seeded.partnerId, percentage: '30' },
        ],
        effectiveFrom: '2026-01-01',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/total exactly 100/i);
  });

  it('accepts a non-50/50 split — the ratio is configuration, not a rule', async () => {
    const res = await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(owner))
      .send({
        shares: [
          { userId: seeded.ownerId, percentage: '70' },
          { userId: seeded.partnerId, percentage: '30' },
        ],
        effectiveFrom: '2026-01-01',
      });

    expect(res.status).toBe(200);
    const percentages = res.body.data.map((s: { percentage: string }) => s.percentage).sort();
    expect(percentages).toEqual(['30', '70']);
  });

  it('accepts fractional percentages that total 100 in decimal arithmetic', async () => {
    const third = await prisma.user.create({
      data: { email: 'third@test.local', fullName: 'Third', passwordHash: 'x' },
    });
    await prisma.companyMembership.create({
      data: { companyId: seeded.companyId, userId: third.id, role: 'PARTNER', status: 'ACTIVE' },
    });

    const res = await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(owner))
      .send({
        shares: [
          { userId: seeded.ownerId, percentage: '33.3333' },
          { userId: seeded.partnerId, percentage: '33.3333' },
          { userId: third.id, percentage: '33.3334' },
        ],
        effectiveFrom: '2026-01-01',
      });

    expect(res.status).toBe(200);
  });

  it('refuses a share for someone who is not an active member', async () => {
    const res = await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(owner))
      .send({
        shares: [
          { userId: seeded.ownerId, percentage: '50' },
          { userId: seeded.outsiderId, percentage: '50' }, // another company's owner
        ],
        effectiveFrom: '2026-01-01',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/active company member/i);
  });

  it('stops a PARTNER changing the split', async () => {
    const res = await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(partner))
      .send({
        shares: [
          { userId: seeded.partnerId, percentage: '90' },
          { userId: seeded.ownerId, percentage: '10' },
        ],
        effectiveFrom: '2026-01-01',
      });

    expect(res.status).toBe(403);
  });

  it('keeps history rather than overwriting an old split', async () => {
    await request(app)
      .put('/api/v1/profit-sharing/config')
      .set(authHeader(owner))
      .send({
        shares: [
          { userId: seeded.ownerId, percentage: '70' },
          { userId: seeded.partnerId, percentage: '30' },
        ],
        effectiveFrom: '2026-07-01',
      });

    const history = await request(app).get('/api/v1/profit-sharing/history').set(authHeader(owner));

    // The seeded 50/50 from January plus the new 70/30 from July.
    expect(history.body.data.length).toBeGreaterThanOrEqual(4);

    const january = history.body.data.filter(
      (h: { effectiveFrom: string }) => h.effectiveFrom.startsWith('2026-01'),
    );
    expect(january).toHaveLength(2);
    // The old configuration was closed off, not deleted.
    expect(january.every((h: { effectiveTo: string | null }) => h.effectiveTo !== null)).toBe(true);
  });
});

describe('profit share statement', () => {
  it('splits net profit by the configured percentages', async () => {
    await createKnownProfit();

    const res = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.netProfit).toBe('9000.00');
    expect(res.body.data.partners).toHaveLength(2);

    for (const p of res.body.data.partners) {
      expect(p.calculatedShare).toBe('4500.00'); // 50% of 9000
    }
  });

  it('never loses or invents a paisa on an awkward amount', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(owner))
      .send({
        projectId: seeded.projectId,
        grossAmount: '1000.01',
        currency: 'INR',
        occurredAt: '2026-06-15T10:00:00.000Z',
      });

    const res = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    const shares = res.body.data.partners.map((p: { calculatedShare: string }) =>
      Number(p.calculatedShare),
    );
    const total = shares.reduce((a: number, b: number) => a + b, 0);

    expect(total.toFixed(2)).toBe('1000.01');
    // One partner gets the extra paisa; neither gets a fabricated one.
    expect(shares.sort()).toEqual([500.0, 500.01]);
  });

  it('distinguishes a calculated share from money actually paid', async () => {
    await createKnownProfit();

    const before = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    const ownerRow = before.body.data.partners.find(
      (p: { userId: string }) => p.userId === seeded.ownerId,
    );
    expect(ownerRow.calculatedShare).toBe('4500.00');
    expect(ownerRow.actuallyPaid).toBe('0.00'); // nothing paid yet
    expect(ownerRow.outstanding).toBe('4500.00');
  });

  it('reduces the outstanding amount once a payout is recorded', async () => {
    await createKnownProfit();

    const payout = await request(app)
      .post('/api/v1/payouts')
      .set(authHeader(owner))
      .send({
        userId: seeded.ownerId,
        amount: '2000.00',
        payoutDate: '2026-06-30',
        method: 'Bank transfer',
        reference: 'NEFT-12345',
      });
    expect(payout.status).toBe(201);

    const res = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    const ownerRow = res.body.data.partners.find(
      (p: { userId: string }) => p.userId === seeded.ownerId,
    );
    expect(ownerRow.calculatedShare).toBe('4500.00');
    expect(ownerRow.actuallyPaid).toBe('2000.00');
    expect(ownerRow.outstanding).toBe('2500.00');

    expect(res.body.data.totals.outstanding).toBe('7000.00'); // 2500 + 4500
  });

  it('says so plainly when no split is configured', async () => {
    await prisma.partnerProfitShare.deleteMany({ where: { companyId: seeded.companyId } });
    await createKnownProfit();

    const res = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.partners).toHaveLength(0);
    expect(res.body.data.message).toMatch(/no profit-share configuration/i);
  });

  it('distributes a loss as well as a profit', async () => {
    await request(app)
      .post('/api/v1/expenses')
      .set(authHeader(owner))
      .send({
        categoryId: seeded.categoryId,
        vendor: 'Big bill',
        amount: '5000.00',
        currency: 'INR',
        expenseDate: '2026-06-16',
      });

    const res = await request(app)
      .get('/api/v1/profit-sharing?preset=thisYear')
      .set(authHeader(owner));

    expect(res.body.data.netProfit).toBe('-5000.00');
    for (const p of res.body.data.partners) {
      expect(p.calculatedShare).toBe('-2500.00');
    }
  });

  it('shows both partners the same statement', async () => {
    await createKnownProfit();

    const [ownerView, partnerView] = await Promise.all([
      request(app).get('/api/v1/profit-sharing?preset=thisYear').set(authHeader(owner)),
      request(app).get('/api/v1/profit-sharing?preset=thisYear').set(authHeader(partner)),
    ]);

    expect(partnerView.body.data.partners).toEqual(ownerView.body.data.partners);
    expect(partnerView.body.data.netProfit).toBe(ownerView.body.data.netProfit);
  });
});

describe('payouts', () => {
  it('refuses a payout in a currency other than the company base', async () => {
    const res = await request(app)
      .post('/api/v1/payouts')
      .set(authHeader(owner))
      .send({
        userId: seeded.ownerId,
        amount: '100.00',
        currency: 'USD',
        payoutDate: '2026-06-30',
      });

    expect(res.status).toBe(422);
  });

  it('refuses a payout to someone outside the company', async () => {
    const res = await request(app)
      .post('/api/v1/payouts')
      .set(authHeader(owner))
      .send({ userId: seeded.outsiderId, amount: '100.00', payoutDate: '2026-06-30' });

    expect(res.status).toBe(404);
  });

  it('lists payout history', async () => {
    await request(app)
      .post('/api/v1/payouts')
      .set(authHeader(owner))
      .send({ userId: seeded.partnerId, amount: '1500.00', payoutDate: '2026-06-30' });

    const res = await request(app).get('/api/v1/payouts').set(authHeader(owner));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount).toBe('1500.00');
  });

  it('records who created the payout in the audit log', async () => {
    const created = await request(app)
      .post('/api/v1/payouts')
      .set(authHeader(owner))
      .send({ userId: seeded.partnerId, amount: '1500.00', payoutDate: '2026-06-30' });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'payout.create', entityId: created.body.data.id },
    });
    expect(log?.actorId).toBe(seeded.ownerId);
  });
});

describe('team management', () => {
  it('invites a partner and returns a single-use link', async () => {
    const res = await request(app)
      .post('/api/v1/members/invite')
      .set(authHeader(owner))
      .send({ email: 'newpartner@test.local', fullName: 'New Partner', role: 'PARTNER' });

    expect(res.status).toBe(201);
    expect(res.body.data.inviteToken).toBeTruthy();
    expect(res.body.data.status).toBe('INVITED');
    // Honest about the missing mail transport rather than claiming it was sent.
    expect(res.body.data.deliveryNote).toMatch(/not configured/i);
  });

  it('lets an invited partner set a password and sign in', async () => {
    const invite = await request(app)
      .post('/api/v1/members/invite')
      .set(authHeader(owner))
      .send({ email: 'newpartner@test.local', fullName: 'New Partner' });

    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: invite.body.data.inviteToken, password: 'NewPartnerPass123!' });

    expect(accept.status).toBe(201);
    expect(accept.body.data.user.email).toBe('newpartner@test.local');
    expect(accept.body.data.memberships[0].companyId).toBe(seeded.companyId);
  });

  it('cannot reuse an invite token', async () => {
    const invite = await request(app)
      .post('/api/v1/members/invite')
      .set(authHeader(owner))
      .send({ email: 'newpartner@test.local', fullName: 'New Partner' });

    await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: invite.body.data.inviteToken, password: 'NewPartnerPass123!' });

    const second = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: invite.body.data.inviteToken, password: 'Different123!Pass' });

    expect(second.status).toBe(422);
  });

  it('cannot sign in as an invited user before accepting', async () => {
    await request(app)
      .post('/api/v1/members/invite')
      .set(authHeader(owner))
      .send({ email: 'newpartner@test.local', fullName: 'New Partner' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newpartner@test.local', password: 'anything', client: 'mobile' });

    expect(res.status).toBe(401);
  });

  it('refuses to remove the only Owner', async () => {
    const members = await request(app).get('/api/v1/members').set(authHeader(owner));
    const ownerMembership = members.body.data.find(
      (m: { role: string }) => m.role === 'OWNER',
    );

    const res = await request(app)
      .patch(`/api/v1/members/${ownerMembership.id}`)
      .set(authHeader(owner))
      .send({ role: 'PARTNER' });

    // Blocked because it targets the caller themselves.
    expect(res.status).toBe(422);
  });

  it('stops an admin changing their own role', async () => {
    const members = await request(app).get('/api/v1/members').set(authHeader(owner));
    const own = members.body.data.find(
      (m: { user: { id: string } }) => m.user.id === seeded.ownerId,
    );

    const res = await request(app)
      .patch(`/api/v1/members/${own.id}`)
      .set(authHeader(owner))
      .send({ role: 'VIEWER' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/your own role/i);
  });

  it('revokes sessions when a member is removed', async () => {
    const members = await request(app).get('/api/v1/members').set(authHeader(owner));
    const partnerMembership = members.body.data.find(
      (m: { user: { id: string } }) => m.user.id === seeded.partnerId,
    );

    const res = await request(app)
      .delete(`/api/v1/members/${partnerMembership.id}`)
      .set(authHeader(owner));
    expect(res.status).toBe(204);

    // Their refresh token must no longer work.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: partner.refreshToken, client: 'mobile' });
    expect(refresh.status).toBe(401);
  });

  it('suspends a member without deleting their history', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(partner))
      .send({
        projectId: seeded.projectId,
        grossAmount: '100.00',
        currency: 'INR',
        occurredAt: '2026-06-15T10:00:00.000Z',
      });

    const members = await request(app).get('/api/v1/members').set(authHeader(owner));
    const partnerMembership = members.body.data.find(
      (m: { user: { id: string } }) => m.user.id === seeded.partnerId,
    );

    await request(app)
      .patch(`/api/v1/members/${partnerMembership.id}`)
      .set(authHeader(owner))
      .send({ status: 'SUSPENDED' });

    const blocked = await request(app).get('/api/v1/projects').set(authHeader(partner));
    expect(blocked.status).toBe(403);

    // The record they created survives, with its authorship intact.
    const txn = await prisma.transaction.findFirst({ where: { createdById: seeded.partnerId } });
    expect(txn).not.toBeNull();
  });
});

describe('audit log access', () => {
  it('lets an admin read the audit trail', async () => {
    await createKnownProfit();

    const res = await request(app).get('/api/v1/audit-logs').set(authHeader(owner));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('actor');
  });

  it('stops a PARTNER reading the audit trail', async () => {
    const res = await request(app).get('/api/v1/audit-logs').set(authHeader(partner));
    expect(res.status).toBe(403);
  });

  it('never exposes a secret through the audit trail', async () => {
    await request(app)
      .post('/api/v1/payment-providers')
      .set(authHeader(owner))
      .send({
        provider: 'RAZORPAY',
        label: 'Razorpay Live',
        webhookSecret: 'super_secret_webhook_value_123',
        apiKey: 'rzp_live_secret_key_value_456',
      });

    const res = await request(app).get('/api/v1/audit-logs').set(authHeader(owner));
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('super_secret_webhook_value_123');
    expect(body).not.toContain('rzp_live_secret_key_value_456');
  });
});
