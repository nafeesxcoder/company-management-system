import argon2 from 'argon2';
import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../../src/config/prisma.js';

/**
 * Integration-test fixtures.
 *
 * Every test file starts from a truncated database, so tests never depend on
 * each other's leftovers and can run in any order.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Child-first order so foreign keys never block the truncate. */
const TABLES_IN_DELETE_ORDER = [
  'audit_logs',
  'notifications',
  'refunds',
  'transactions',
  'invoices',
  'subscriptions',
  'provider_product_mappings',
  'webhook_events',
  'payment_provider_accounts',
  'expenses',
  'expense_categories',
  'partner_payouts',
  'partner_profit_shares',
  'exchange_rates',
  'projects',
  'company_memberships',
  'refresh_tokens',
  'companies',
  'users',
] as const;

/**
 * Deletes in child-first order with foreign keys ENABLED.
 *
 * `SET FOREIGN_KEY_CHECKS = 0` is session-scoped and Prisma hands out a
 * different pooled connection per query, so it would not apply to the
 * statements that follow. Deleting in dependency order is both correct and a
 * free check that the FK graph is what we think it is.
 */
export async function resetDatabase(): Promise<void> {
  for (const table of TABLES_IN_DELETE_ORDER) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
}

export interface SeededCompany {
  companyId: string;
  ownerId: string;
  partnerId: string;
  viewerId: string;
  outsiderId: string;
  otherCompanyId: string;
  categoryId: string;
  projectId: string;
  otherCompanyProjectId: string;
}

export const PASSWORDS = {
  owner: 'OwnerPass123!secure',
  partner: 'PartnerPass123!secure',
  viewer: 'ViewerPass123!secure',
  outsider: 'OutsiderPass123!secure',
} as const;

export const EMAILS = {
  owner: 'owner@test.local',
  partner: 'partner@test.local',
  viewer: 'viewer@test.local',
  outsider: 'outsider@test.local',
} as const;

/**
 * Builds two separate companies. The second exists purely so isolation tests
 * have a real neighbour to fail to reach.
 */
export async function seedTestCompany(): Promise<SeededCompany> {
  const [ownerHash, partnerHash, viewerHash, outsiderHash] = await Promise.all([
    argon2.hash(PASSWORDS.owner, ARGON2_OPTIONS),
    argon2.hash(PASSWORDS.partner, ARGON2_OPTIONS),
    argon2.hash(PASSWORDS.viewer, ARGON2_OPTIONS),
    argon2.hash(PASSWORDS.outsider, ARGON2_OPTIONS),
  ]);

  const company = await prisma.company.create({
    data: { name: 'Test Company', baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
  });
  const otherCompany = await prisma.company.create({
    data: { name: 'Rival Company', baseCurrency: 'INR', timezone: 'Asia/Kolkata' },
  });

  const owner = await prisma.user.create({
    data: { email: EMAILS.owner, fullName: 'Test Owner', passwordHash: ownerHash },
  });
  const partner = await prisma.user.create({
    data: { email: EMAILS.partner, fullName: 'Test Partner', passwordHash: partnerHash },
  });
  const viewer = await prisma.user.create({
    data: { email: EMAILS.viewer, fullName: 'Test Viewer', passwordHash: viewerHash },
  });
  const outsider = await prisma.user.create({
    data: { email: EMAILS.outsider, fullName: 'Rival Owner', passwordHash: outsiderHash },
  });

  await prisma.companyMembership.createMany({
    data: [
      { companyId: company.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: company.id, userId: partner.id, role: 'PARTNER', status: 'ACTIVE', joinedAt: new Date() },
      { companyId: company.id, userId: viewer.id, role: 'VIEWER', status: 'ACTIVE', joinedAt: new Date() },
      {
        companyId: otherCompany.id,
        userId: outsider.id,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    ],
  });

  const category = await prisma.expenseCategory.create({
    data: { companyId: company.id, name: 'Hosting', slug: 'hosting', isSystem: true },
  });

  const project = await prisma.project.create({
    data: {
      companyId: company.id,
      code: 'TEST-1',
      name: 'Test Project',
      currency: 'INR',
      type: 'SAAS',
      revenueModel: 'MONTHLY_SUBSCRIPTION',
      createdById: owner.id,
    },
  });

  const otherProject = await prisma.project.create({
    data: {
      companyId: otherCompany.id,
      code: 'RIVAL-1',
      name: 'Rival Project',
      currency: 'INR',
      createdById: outsider.id,
    },
  });

  const effectiveFrom = new Date(Date.UTC(2026, 0, 1));
  await prisma.partnerProfitShare.createMany({
    data: [
      { companyId: company.id, userId: owner.id, percentage: '50', effectiveFrom, createdById: owner.id },
      { companyId: company.id, userId: partner.id, percentage: '50', effectiveFrom, createdById: owner.id },
    ],
  });

  return {
    companyId: company.id,
    ownerId: owner.id,
    partnerId: partner.id,
    viewerId: viewer.id,
    outsiderId: outsider.id,
    otherCompanyId: otherCompany.id,
    categoryId: category.id,
    projectId: project.id,
    otherCompanyProjectId: otherProject.id,
  };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export async function loginAs(app: Express, email: string, password: string): Promise<Session> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password, client: 'mobile' });

  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return {
    accessToken: response.body.data.accessToken,
    refreshToken: response.body.data.refreshToken,
    userId: response.body.data.user.id,
  };
}

export const authHeader = (session: Session) => ({ Authorization: `Bearer ${session.accessToken}` });
