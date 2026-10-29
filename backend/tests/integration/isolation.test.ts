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

/**
 * Company data isolation.
 *
 * This is the single most important authorisation property in the system: a
 * partner of one company must not be able to see, modify or even confirm the
 * existence of another company's records — not by guessing an id, not by
 * passing a company id header, not through any list endpoint.
 */

let app: Express;
let seeded: SeededCompany;
let owner: Session;
let outsider: Session;
let viewer: Session;
let partner: Session;
let rivalTransactionId: string;
let ownTransactionId: string;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  seeded = await seedTestCompany();

  [owner, outsider, viewer, partner] = await Promise.all([
    loginAs(app, EMAILS.owner, PASSWORDS.owner),
    loginAs(app, EMAILS.outsider, PASSWORDS.outsider),
    loginAs(app, EMAILS.viewer, PASSWORDS.viewer),
    loginAs(app, EMAILS.partner, PASSWORDS.partner),
  ]);

  const own = await prisma.transaction.create({
    data: {
      companyId: seeded.companyId,
      projectId: seeded.projectId,
      currency: 'INR',
      grossAmount: '1000.0000',
      feeAmount: '20.0000',
      occurredAt: new Date(),
      status: 'SUCCEEDED',
    },
  });
  ownTransactionId = own.id;

  const rival = await prisma.transaction.create({
    data: {
      companyId: seeded.otherCompanyId,
      projectId: seeded.otherCompanyProjectId,
      currency: 'INR',
      grossAmount: '999999.0000',
      occurredAt: new Date(),
      status: 'SUCCEEDED',
    },
  });
  rivalTransactionId = rival.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('cross-company reads', () => {
  it('never lists another company projects', async () => {
    const res = await request(app).get('/api/v1/projects').set(authHeader(owner));

    expect(res.status).toBe(200);
    const codes = res.body.data.map((p: { code: string }) => p.code);
    expect(codes).toContain('TEST-1');
    expect(codes).not.toContain('RIVAL-1');
  });

  it('404s on a direct fetch of another company project', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${seeded.otherCompanyProjectId}`)
      .set(authHeader(owner));

    // 404, not 403 — a 403 would confirm the id exists.
    expect(res.status).toBe(404);
  });

  it('404s on a direct fetch of another company transaction', async () => {
    const res = await request(app)
      .get(`/api/v1/transactions/${rivalTransactionId}`)
      .set(authHeader(owner));
    expect(res.status).toBe(404);
  });

  it('never leaks another company revenue into the dashboard', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard?preset=allTime')
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    // Own transaction only: 1000, not 1000 + 999999.
    expect(res.body.data.summary.grossRevenue).toBe('1000.00');
  });

  it('gives the rival a dashboard containing only their own revenue', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard?preset=allTime')
      .set(authHeader(outsider));

    expect(res.status).toBe(200);
    expect(res.body.data.summary.grossRevenue).toBe('999999.00');
  });

  it('ignores a forged X-Company-Id header', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard?preset=allTime')
      .set(authHeader(owner))
      .set('X-Company-Id', seeded.otherCompanyId);

    // The header names a company the user has no membership in.
    expect(res.status).toBe(404);
  });

  it('denies a companyId query parameter pointing at another company', async () => {
    const res = await request(app)
      .get(`/api/v1/transactions?companyId=${seeded.otherCompanyId}`)
      .set(authHeader(owner));

    // Denied outright rather than quietly ignored: an explicit request for
    // another company's data should fail loudly, and 404 (not 403) avoids
    // confirming that the id is real.
    expect(res.status).toBe(404);
  });

  it('honours a companyId naming a company the user DOES belong to', async () => {
    const res = await request(app)
      .get(`/api/v1/transactions?companyId=${seeded.companyId}`)
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(ownTransactionId);
    expect(ids).not.toContain(rivalTransactionId);
  });

  it('excludes another company expenses from the export', async () => {
    await prisma.expense.create({
      data: {
        companyId: seeded.otherCompanyId,
        categoryId: (
          await prisma.expenseCategory.create({
            data: { companyId: seeded.otherCompanyId, name: 'Rival', slug: 'rival' },
          })
        ).id,
        vendor: 'RivalVendor',
        amount: '5000.0000',
        currency: 'INR',
        expenseDate: new Date(),
      },
    });

    const res = await request(app)
      .get('/api/v1/reports/export/expenses?preset=allTime')
      .set(authHeader(owner));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('RivalVendor');
  });
});

describe('cross-company writes', () => {
  it('refuses to record income against another company project', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(owner))
      .send({
        projectId: seeded.otherCompanyProjectId,
        grossAmount: '500.00',
        currency: 'INR',
        occurredAt: new Date().toISOString(),
      });

    expect(res.status).toBe(404);
  });

  it('refuses to update another company transaction', async () => {
    const res = await request(app)
      .patch(`/api/v1/transactions/${rivalTransactionId}`)
      .set(authHeader(owner))
      .send({ grossAmount: '1.00' });

    expect(res.status).toBe(404);

    const unchanged = await prisma.transaction.findUnique({ where: { id: rivalTransactionId } });
    expect(unchanged?.grossAmount.toString()).toBe('999999');
  });

  it('refuses to refund another company transaction', async () => {
    const res = await request(app)
      .post(`/api/v1/transactions/${rivalTransactionId}/refunds`)
      .set(authHeader(owner))
      .send({ amount: '100.00' });

    expect(res.status).toBe(404);
    expect(await prisma.refund.count()).toBe(0);
  });

  it('refuses to delete another company project', async () => {
    const res = await request(app)
      .delete(`/api/v1/projects/${seeded.otherCompanyProjectId}`)
      .set(authHeader(owner));

    expect(res.status).toBe(404);
    expect(await prisma.project.findUnique({ where: { id: seeded.otherCompanyProjectId } })).not.toBeNull();
  });

  it('refuses to file an expense against another company project', async () => {
    const res = await request(app)
      .post('/api/v1/expenses')
      .set(authHeader(owner))
      .send({
        projectId: seeded.otherCompanyProjectId,
        categoryId: seeded.categoryId,
        vendor: 'Test',
        amount: '100.00',
        currency: 'INR',
        expenseDate: '2026-10-01',
      });

    expect(res.status).toBe(404);
  });
});

describe('role-based access control', () => {
  it('lets a VIEWER read', async () => {
    const res = await request(app).get('/api/v1/projects').set(authHeader(viewer));
    expect(res.status).toBe(200);
  });

  it('stops a VIEWER creating a project', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(authHeader(viewer))
      .send({ code: 'VIEWER-1', name: 'Should not exist', currency: 'INR' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('stops a VIEWER recording income', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(viewer))
      .send({
        projectId: seeded.projectId,
        grossAmount: '100.00',
        currency: 'INR',
        occurredAt: new Date().toISOString(),
      });

    expect(res.status).toBe(403);
  });

  it('lets a PARTNER record income', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(partner))
      .send({
        projectId: seeded.projectId,
        grossAmount: '250.50',
        currency: 'INR',
        occurredAt: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.grossAmount).toBe('250.50');
  });

  it('stops a PARTNER deleting a transaction (admin only)', async () => {
    const res = await request(app)
      .delete(`/api/v1/transactions/${ownTransactionId}`)
      .set(authHeader(partner));

    expect(res.status).toBe(403);
  });

  it('lets an OWNER delete a transaction', async () => {
    const res = await request(app)
      .delete(`/api/v1/transactions/${ownTransactionId}`)
      .set(authHeader(owner));

    expect(res.status).toBe(204);
  });

  it('blocks a suspended member entirely', async () => {
    await prisma.companyMembership.updateMany({
      where: { userId: seeded.partnerId, companyId: seeded.companyId },
      data: { status: 'SUSPENDED' },
    });

    const res = await request(app).get('/api/v1/projects').set(authHeader(partner));
    expect(res.status).toBe(403);
  });
});

describe('both partners see the same figures', () => {
  it('returns identical dashboard totals for owner and partner', async () => {
    const [ownerView, partnerView] = await Promise.all([
      request(app).get('/api/v1/dashboard?preset=allTime').set(authHeader(owner)),
      request(app).get('/api/v1/dashboard?preset=allTime').set(authHeader(partner)),
    ]);

    expect(ownerView.status).toBe(200);
    expect(partnerView.status).toBe(200);
    expect(partnerView.body.data.summary).toEqual(ownerView.body.data.summary);
    expect(partnerView.body.data.revenueByProject).toEqual(ownerView.body.data.revenueByProject);
  });

  it('shows a partner income the owner recorded, immediately', async () => {
    await request(app)
      .post('/api/v1/transactions')
      .set(authHeader(owner))
      .send({
        projectId: seeded.projectId,
        grossAmount: '7777.00',
        currency: 'INR',
        occurredAt: new Date().toISOString(),
      });

    const res = await request(app).get('/api/v1/transactions').set(authHeader(partner));
    const amounts = res.body.data.map((t: { grossAmount: string }) => t.grossAmount);
    expect(amounts).toContain('7777.00');
  });
});
