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

const api = () => request(app);

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedTestCompany();
  owner = await loginAs(app, EMAILS.owner, PASSWORDS.owner);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function recordIncome(overrides: Record<string, unknown> = {}) {
  return api()
    .post('/api/v1/transactions')
    .set(authHeader(owner))
    .send({
      projectId: seeded.projectId,
      grossAmount: '1000.00',
      feeAmount: '0.00',
      currency: 'INR',
      occurredAt: '2026-10-05T10:00:00.000Z',
      ...overrides,
    });
}

describe('manual income entry', () => {
  it('records income and returns computed net', async () => {
    const res = await recordIncome({ grossAmount: '1999.99', feeAmount: '47.18' });

    expect(res.status).toBe(201);
    expect(res.body.data.grossAmount).toBe('1999.99');
    expect(res.body.data.feeAmount).toBe('47.18');
    expect(res.body.data.netAmount).toBe('1952.81'); // 1999.99 − 0 − 47.18
    expect(res.body.data.refundableRemaining).toBe('1999.99');
  });

  it('preserves decimal precision exactly through the database', async () => {
    await recordIncome({ grossAmount: '0.10' });
    await recordIncome({ grossAmount: '0.20' });

    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(res.body.data.summary.grossRevenue).toBe('0.30'); // not 0.30000000000000004
  });

  it('rejects a money value sent as a JSON number', async () => {
    const res = await api()
      .post('/api/v1/transactions')
      .set(authHeader(owner))
      .send({
        projectId: seeded.projectId,
        grossAmount: 1999.99, // number, not string
        currency: 'INR',
        occurredAt: '2026-10-05T10:00:00.000Z',
      });

    expect(res.status).toBe(400);
  });

  it('rejects a fee larger than the gross', async () => {
    const res = await recordIncome({ grossAmount: '100.00', feeAmount: '200.00' });
    expect(res.status).toBe(400);
  });

  it('rejects a negative amount', async () => {
    const res = await recordIncome({ grossAmount: '-100.00' });
    expect(res.status).toBe(400);
  });

  it('rejects more than 4 decimal places', async () => {
    const res = await recordIncome({ grossAmount: '100.123456' });
    expect(res.status).toBe(400);
  });

  it('refuses a duplicate provider reference so revenue is never double-counted', async () => {
    const first = await recordIncome({ provider: 'STRIPE', externalTransactionId: 'ch_abc123' });
    expect(first.status).toBe(201);

    const second = await recordIncome({ provider: 'STRIPE', externalTransactionId: 'ch_abc123' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    expect(await prisma.transaction.count()).toBe(1);
  });
});

describe('multi-currency', () => {
  it('refuses a foreign currency with no exchange rate', async () => {
    const res = await recordIncome({ currency: 'USD', grossAmount: '100.00' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CURRENCY_MISMATCH');
    expect(res.body.error.message).toMatch(/exchangeRateToBase/);
  });

  it('accepts a foreign currency with a rate and converts for totals', async () => {
    const res = await recordIncome({
      currency: 'USD',
      grossAmount: '100.00',
      exchangeRateToBase: '83.25',
    });
    expect(res.status).toBe(201);

    const dashboard = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(dashboard.body.data.summary.grossRevenue).toBe('8325.00');
    expect(dashboard.body.data.dataQuality.hasUnconvertedRecords).toBe(false);
  });

  it('flags records that cannot be converted instead of silently dropping them', async () => {
    await recordIncome({ grossAmount: '1000.00' });

    // Written straight to the database, bypassing the API guard, to simulate a
    // legacy import that arrived without a rate.
    await prisma.transaction.create({
      data: {
        companyId: seeded.companyId,
        projectId: seeded.projectId,
        currency: 'EUR',
        grossAmount: '500.0000',
        occurredAt: new Date('2026-10-05'),
        status: 'SUCCEEDED',
      },
    });

    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(res.body.data.summary.grossRevenue).toBe('1000.00');
    expect(res.body.data.dataQuality.hasUnconvertedRecords).toBe(true);
    expect(res.body.data.dataQuality.unconvertedRecords).toBe(1);
  });
});

describe('refunds', () => {
  let transactionId: string;

  beforeEach(async () => {
    const res = await recordIncome({ grossAmount: '1000.00', feeAmount: '23.60' });
    transactionId = res.body.data.id;
  });

  it('records a partial refund and updates the transaction atomically', async () => {
    const res = await api()
      .post(`/api/v1/transactions/${transactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '250.00', reason: 'Customer downgraded' });

    expect(res.status).toBe(201);
    expect(res.body.data.refund.isPartial).toBe(true);
    expect(res.body.data.transaction.status).toBe('PARTIALLY_REFUNDED');
    expect(res.body.data.transaction.refundedAmount).toBe('250.00');
    expect(res.body.data.transaction.refundableRemaining).toBe('750.00');
  });

  it('marks a transaction REFUNDED when fully refunded', async () => {
    const res = await api()
      .post(`/api/v1/transactions/${transactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '1000.00' });

    expect(res.body.data.refund.isPartial).toBe(false);
    expect(res.body.data.transaction.status).toBe('REFUNDED');
    expect(res.body.data.transaction.refundableRemaining).toBe('0.00');
  });

  it('refuses to refund more than the remaining balance', async () => {
    await api()
      .post(`/api/v1/transactions/${transactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '800.00' });

    const res = await api()
      .post(`/api/v1/transactions/${transactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '300.00' }); // only 200 left

    expect(res.status).toBe(422);
    expect(res.body.error.details.refundableRemaining).toBe('200.00');

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    expect(txn?.refundedAmount.toString()).toBe('800');
  });

  it('keeps the running total consistent across several partial refunds', async () => {
    for (const amount of ['100.00', '250.50', '49.50']) {
      const res = await api()
        .post(`/api/v1/transactions/${transactionId}/refunds`)
        .set(authHeader(owner))
        .send({ amount });
      expect(res.status).toBe(201);
    }

    const txn = await api().get(`/api/v1/transactions/${transactionId}`).set(authHeader(owner));
    expect(txn.body.data.refundedAmount).toBe('400.00');
    expect(txn.body.data.refunds).toHaveLength(3);

    const sum = txn.body.data.refunds.reduce(
      (acc: number, r: { amount: string }) => acc + Number(r.amount),
      0,
    );
    expect(sum.toFixed(2)).toBe('400.00');
  });

  it('serialises concurrent refunds so the transaction cannot be over-refunded', async () => {
    // Five simultaneous 300.00 refunds against a 1000.00 transaction.
    // Exactly three fit (900.00); the remaining two must be rejected cleanly,
    // not crash with a deadlock and not partially apply.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api()
          .post(`/api/v1/transactions/${transactionId}/refunds`)
          .set(authHeader(owner))
          .send({ amount: '300.00' }),
      ),
    );

    const accepted = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status !== 201);

    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(2);
    // Rejected for the business reason, not an internal error.
    for (const res of rejected) {
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE');
    }

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    expect(txn?.refundedAmount.toString()).toBe('900');
    expect(txn?.status).toBe('PARTIALLY_REFUNDED');

    // The refund rows and the running total must agree exactly.
    const rows = await prisma.refund.findMany({ where: { transactionId } });
    expect(rows).toHaveLength(3);
    const sum = rows.reduce((acc, r) => acc + Number(r.amount.toString()), 0);
    expect(sum).toBe(900);
  });

  it('refuses to refund a pending payment', async () => {
    const pending = await recordIncome({ grossAmount: '500.00', status: 'PENDING' });

    const res = await api()
      .post(`/api/v1/transactions/${pending.body.data.id}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '100.00' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/no money was received/i);
  });

  it('reverses a refund recorded in error and restores the transaction', async () => {
    const refund = await api()
      .post(`/api/v1/transactions/${transactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '250.00' });

    const res = await api()
      .delete(`/api/v1/refunds/${refund.body.data.refund.id}`)
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.transaction.refundedAmount).toBe('0.00');
    expect(res.body.data.transaction.status).toBe('SUCCEEDED');
  });
});

describe('dashboard figures', () => {
  beforeEach(async () => {
    await recordIncome({ grossAmount: '10000.00', feeAmount: '236.00' });
    await recordIncome({ grossAmount: '5000.00', feeAmount: '118.00', status: 'PENDING' });
    await recordIncome({ grossAmount: '3000.00', status: 'FAILED' });

    await api()
      .post('/api/v1/expenses')
      .set(authHeader(owner))
      .send({
        projectId: seeded.projectId,
        categoryId: seeded.categoryId,
        vendor: 'Cloud Host',
        amount: '2000.00',
        currency: 'INR',
        expenseDate: '2026-10-03',
      });
  });

  it('computes the headline figures correctly', async () => {
    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    const s = res.body.data.summary;

    expect(s.grossRevenue).toBe('10000.00'); // pending and failed excluded
    expect(s.pendingPayments).toBe('5000.00');
    expect(s.processingFees).toBe('236.00'); // pending transaction's fee not counted
    expect(s.eligibleExpenses).toBe('2000.00');
    expect(s.netRevenue).toBe('10000.00');
    expect(s.netProfit).toBe('7764.00'); // 10000 − 236 − 2000
  });

  it('subtracts refunds from net revenue and profit', async () => {
    const list = await api().get('/api/v1/transactions?status=SUCCEEDED').set(authHeader(owner));
    const txnId = list.body.data[0].id;

    await api()
      .post(`/api/v1/transactions/${txnId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '1000.00' });

    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(res.body.data.summary.totalRefunds).toBe('1000.00');
    expect(res.body.data.summary.netRevenue).toBe('9000.00');
    expect(res.body.data.summary.netProfit).toBe('6764.00');
  });

  it('does not double-count a gateway fee also entered as an expense', async () => {
    await api()
      .post('/api/v1/expenses')
      .set(authHeader(owner))
      .send({
        categoryId: seeded.categoryId,
        vendor: 'Stripe fees',
        amount: '236.00',
        currency: 'INR',
        expenseDate: '2026-10-03',
        excludeFromProfit: true,
      });

    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(res.body.data.summary.eligibleExpenses).toBe('2000.00'); // unchanged
    expect(res.body.data.summary.totalExpenses).toBe('2236.00'); // recorded, visible
    expect(res.body.data.summary.netProfit).toBe('7764.00'); // unchanged
  });

  it('breaks revenue down by project', async () => {
    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    const row = res.body.data.revenueByProject.find(
      (p: { projectId: string }) => p.projectId === seeded.projectId,
    );

    expect(row.netRevenue).toBe('10000.00');
    expect(row.expenses).toBe('2000.00');
    expect(row.netProfit).toBe('7764.00');
  });

  it('breaks expenses down by category', async () => {
    const res = await api().get('/api/v1/dashboard?preset=allTime').set(authHeader(owner));
    expect(res.body.data.expensesByCategory[0].total).toBe('2000.00');
    expect(res.body.data.expensesByCategory[0].name).toBe('Hosting');
  });

  it('returns a continuous monthly trend with no gaps', async () => {
    const res = await api()
      .get('/api/v1/dashboard?preset=custom&from=2026-08-01&to=2026-10-31')
      .set(authHeader(owner));

    const months = res.body.data.monthlyTrend.map((m: { month: string }) => m.month);
    expect(months).toEqual(['2026-08', '2026-09', '2026-10']);

    const october = res.body.data.monthlyTrend.find((m: { month: string }) => m.month === '2026-10');
    expect(october.netRevenue).toBe('10000.00');
  });

  it('respects the date filter', async () => {
    const res = await api()
      .get('/api/v1/dashboard?preset=custom&from=2026-01-01&to=2026-01-31')
      .set(authHeader(owner));

    expect(res.body.data.summary.grossRevenue).toBe('0.00');
  });
});

describe('profit and loss report', () => {
  it('reports the figures with their definitions', async () => {
    await recordIncome({ grossAmount: '10000.00', feeAmount: '200.00' });

    const res = await api().get('/api/v1/reports/profit-loss?preset=allTime').set(authHeader(owner));

    expect(res.status).toBe(200);
    expect(res.body.data.revenue.netRevenue).toBe('10000.00');
    expect(res.body.data.result.netProfit).toBe('9800.00');
    expect(res.body.data.result.profitMargin).toBe('98');
    expect(res.body.data.definitions.netProfit).toContain('Net revenue minus');
  });
});

describe('CSV export', () => {
  it('exports transactions with a BOM and computed base-currency column', async () => {
    await recordIncome({ grossAmount: '1500.00', feeAmount: '35.40' });

    const res = await api()
      .get('/api/v1/reports/export/transactions?preset=allTime')
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // BOM for Excel
    expect(res.text).toContain('project_code');
    expect(res.text).toContain('TEST-1');
    expect(res.text).toContain('1464.60'); // net: 1500 − 35.40
  });

  it('marks unconvertible rows rather than inventing a figure', async () => {
    await prisma.transaction.create({
      data: {
        companyId: seeded.companyId,
        projectId: seeded.projectId,
        currency: 'EUR',
        grossAmount: '500.0000',
        occurredAt: new Date('2026-10-05'),
        status: 'SUCCEEDED',
      },
    });

    const res = await api()
      .get('/api/v1/reports/export/transactions?preset=allTime')
      .set(authHeader(owner));

    expect(res.text).toContain('NOT_CONVERTED');
  });

  it('neutralises spreadsheet formula injection in a vendor name', async () => {
    await api()
      .post('/api/v1/expenses')
      .set(authHeader(owner))
      .send({
        categoryId: seeded.categoryId,
        vendor: '=HYPERLINK("http://evil.test","click")',
        amount: '10.00',
        currency: 'INR',
        expenseDate: '2026-10-03',
      });

    const res = await api()
      .get('/api/v1/reports/export/expenses?preset=allTime')
      .set(authHeader(owner));

    // Quoted and prefixed with ' so Excel treats it as text, not a formula.
    expect(res.text).toContain("'=HYPERLINK");
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/);
  });
});

describe('projects', () => {
  it('creates, updates and archives a project', async () => {
    const create = await api()
      .post('/api/v1/projects')
      .set(authHeader(owner))
      .send({
        code: 'NEW-APP',
        name: 'New App',
        type: 'MOBILE_APPLICATION',
        revenueModel: 'IN_APP_PURCHASE',
        currency: 'INR',
      });
    expect(create.status).toBe(201);

    const id = create.body.data.id;

    const update = await api()
      .patch(`/api/v1/projects/${id}`)
      .set(authHeader(owner))
      .send({ name: 'Renamed App', status: 'PAUSED' });
    expect(update.body.data.name).toBe('Renamed App');

    const archive = await api().post(`/api/v1/projects/${id}/archive`).set(authHeader(owner));
    expect(archive.body.data.status).toBe('ARCHIVED');

    const list = await api().get('/api/v1/projects').set(authHeader(owner));
    expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(id);

    const withArchived = await api()
      .get('/api/v1/projects?includeArchived=true')
      .set(authHeader(owner));
    expect(withArchived.body.data.map((p: { id: string }) => p.id)).toContain(id);
  });

  it('rejects a duplicate project code within the company', async () => {
    const res = await api()
      .post('/api/v1/projects')
      .set(authHeader(owner))
      .send({ code: 'TEST-1', name: 'Clashing', currency: 'INR' });

    expect(res.status).toBe(409);
  });

  it('refuses to delete a project that has financial records', async () => {
    await recordIncome();

    const res = await api().delete(`/api/v1/projects/${seeded.projectId}`).set(authHeader(owner));
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/archive it instead/i);
  });

  it('refuses to change currency once transactions exist', async () => {
    await recordIncome();

    const res = await api()
      .patch(`/api/v1/projects/${seeded.projectId}`)
      .set(authHeader(owner))
      .send({ currency: 'USD' });

    expect(res.status).toBe(422);
  });

  it('returns per-project financials', async () => {
    await recordIncome({ grossAmount: '4000.00', feeAmount: '100.00' });

    const res = await api()
      .get(`/api/v1/projects/${seeded.projectId}?preset=allTime`)
      .set(authHeader(owner));

    expect(res.body.data.financials.netRevenue).toBe('4000.00');
    expect(res.body.data.financials.netProfit).toBe('3900.00');
  });
});

describe('audit trail', () => {
  it('records who created each financial record', async () => {
    const res = await recordIncome({ grossAmount: '555.00' });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'transaction.create', entityId: res.body.data.id },
    });

    expect(log).not.toBeNull();
    expect(log?.actorId).toBe(seeded.ownerId);
    expect(log?.summary).toContain('555.00');
  });

  it('records before and after on an update', async () => {
    const created = await recordIncome({ grossAmount: '100.00' });

    await api()
      .patch(`/api/v1/transactions/${created.body.data.id}`)
      .set(authHeader(owner))
      .send({ grossAmount: '200.00' });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'transaction.update' },
      orderBy: { createdAt: 'desc' },
    });

    expect((log?.beforeData as Record<string, unknown>).grossAmount).toBe('100.00');
    expect((log?.afterData as Record<string, unknown>).grossAmount).toBe('200.00');
  });
});
