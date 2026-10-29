import 'dotenv/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';
import argon2 from 'argon2';

/**
 * Seed script.
 *
 * Creates ONLY the reference data a new installation needs:
 *   - the company
 *   - the two partner accounts
 *   - system expense categories
 *   - an explicit profit-share configuration (never an implied 50/50)
 *
 * Demo financial records are created only when SEED_DEMO=true, and they are
 * clearly labelled. Production seeds must never invent revenue.
 *
 * Usage:
 *   SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... npm run seed
 */

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 5,
  };
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(parseDatabaseUrl(env('DATABASE_URL'))) });

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const SYSTEM_EXPENSE_CATEGORIES = [
  { name: 'Hosting & Infrastructure', slug: 'hosting-infrastructure', color: '#2563eb' },
  { name: 'Domains & SSL', slug: 'domains-ssl', color: '#0891b2' },
  { name: 'Database Hosting', slug: 'database-hosting', color: '#7c3aed' },
  { name: 'Software Subscriptions', slug: 'software-subscriptions', color: '#db2777' },
  { name: 'Advertising & Marketing', slug: 'advertising-marketing', color: '#ea580c' },
  { name: 'App Store & Publishing Fees', slug: 'app-publishing-fees', color: '#16a34a' },
  { name: 'Developer & Contractor Payments', slug: 'developer-payments', color: '#ca8a04' },
  { name: 'Payment Gateway Charges', slug: 'payment-gateway-charges', color: '#dc2626' },
  { name: 'Professional Services', slug: 'professional-services', color: '#4f46e5' },
  { name: 'Office & Equipment', slug: 'office-equipment', color: '#0d9488' },
  { name: 'Taxes & Compliance', slug: 'taxes-compliance', color: '#64748b' },
  { name: 'Other', slug: 'other', color: '#94a3b8' },
];

async function main(): Promise<void> {
  const companyName = env('SEED_COMPANY_NAME', 'My Company');
  const baseCurrency = env('SEED_BASE_CURRENCY', 'INR').toUpperCase();
  const timezone = env('SEED_TIMEZONE', 'Asia/Kolkata');

  const ownerEmail = env('SEED_OWNER_EMAIL', 'owner@example.com').toLowerCase();
  const ownerName = env('SEED_OWNER_NAME', 'Partner One');
  const ownerPassword = env('SEED_OWNER_PASSWORD', 'ChangeMe123!Now');

  const partnerEmail = env('SEED_PARTNER_EMAIL', 'partner@example.com').toLowerCase();
  const partnerName = env('SEED_PARTNER_NAME', 'Partner Two');
  const partnerPassword = env('SEED_PARTNER_PASSWORD', 'ChangeMe123!Now');

  const ownerShare = env('SEED_OWNER_SHARE', '50');
  const partnerShare = env('SEED_PARTNER_SHARE', '50');

  if (Number(ownerShare) + Number(partnerShare) !== 100) {
    throw new Error(
      `SEED_OWNER_SHARE + SEED_PARTNER_SHARE must equal 100 (got ${ownerShare} + ${partnerShare})`,
    );
  }

  console.log(`\nSeeding "${companyName}" (${baseCurrency})…`);

  const existingCompany = await prisma.company.findFirst({ where: { name: companyName } });
  const company =
    existingCompany ??
    (await prisma.company.create({
      data: { name: companyName, baseCurrency, timezone },
    }));
  console.log(`  company:  ${company.name} [${company.id}]`);

  const [ownerHash, partnerHash] = await Promise.all([
    argon2.hash(ownerPassword, ARGON2_OPTIONS),
    argon2.hash(partnerPassword, ARGON2_OPTIONS),
  ]);

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {},
    create: { email: ownerEmail, fullName: ownerName, passwordHash: ownerHash, timezone, isActive: true },
  });
  console.log(`  owner:    ${owner.email}`);

  const partner = await prisma.user.upsert({
    where: { email: partnerEmail },
    update: {},
    create: { email: partnerEmail, fullName: partnerName, passwordHash: partnerHash, timezone, isActive: true },
  });
  console.log(`  partner:  ${partner.email}`);

  await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: { companyId: company.id, userId: owner.id, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
  });

  await prisma.companyMembership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: partner.id } },
    update: { role: 'PARTNER', status: 'ACTIVE' },
    create: { companyId: company.id, userId: partner.id, role: 'PARTNER', status: 'ACTIVE', joinedAt: new Date() },
  });
  console.log('  memberships: OWNER + PARTNER');

  for (const category of SYSTEM_EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { companyId_slug: { companyId: company.id, slug: category.slug } },
      update: {},
      create: { ...category, companyId: company.id, isSystem: true },
    });
  }
  console.log(`  expense categories: ${SYSTEM_EXPENSE_CATEGORIES.length}`);

  // Profit share is written explicitly, effective from the start of this fiscal
  // year. It is configurable data, not a hardcoded rule.
  const effectiveFrom = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  for (const [userId, percentage] of [
    [owner.id, ownerShare],
    [partner.id, partnerShare],
  ] as const) {
    await prisma.partnerProfitShare.upsert({
      where: { companyId_userId_effectiveFrom: { companyId: company.id, userId, effectiveFrom } },
      update: { percentage },
      create: {
        companyId: company.id,
        userId,
        percentage,
        effectiveFrom,
        createdById: owner.id,
        note: 'Initial configuration created by the seed script',
      },
    });
  }
  console.log(`  profit share: ${ownerShare}/${partnerShare}`);

  if (process.env.SEED_DEMO === 'true') {
    await seedDemoData(company.id, owner.id);
  } else {
    console.log('\n  (no demo data — set SEED_DEMO=true for sample records)');
  }

  console.log('\nSeed complete.\n');
  if (ownerPassword === 'ChangeMe123!Now' || partnerPassword === 'ChangeMe123!Now') {
    console.log('  ⚠  Default passwords were used. Change them before exposing this instance.\n');
  }
}

/** Clearly-labelled demo records, for local development only. */
async function seedDemoData(companyId: string, createdById: string): Promise<void> {
  console.log('\n  seeding DEMO data (SEED_DEMO=true)…');

  const projects = await Promise.all(
    [
      { code: 'DEMO-SAAS', name: '[DEMO] Invoice SaaS', type: 'SAAS', revenueModel: 'MONTHLY_SUBSCRIPTION' },
      { code: 'DEMO-APP', name: '[DEMO] Dating App', type: 'MOBILE_APPLICATION', revenueModel: 'IN_APP_PURCHASE' },
      { code: 'DEMO-CLIENT', name: '[DEMO] Client Website', type: 'CLIENT_WEBSITE', revenueModel: 'CLIENT_MILESTONE' },
    ].map((p) =>
      prisma.project.upsert({
        where: { companyId_code: { companyId, code: p.code } },
        update: {},
        create: {
          companyId,
          code: p.code,
          name: p.name,
          type: p.type as never,
          revenueModel: p.revenueModel as never,
          currency: 'INR',
          status: 'ACTIVE',
          createdById,
          description: 'Demo record created by the seed script. Safe to delete.',
        },
      }),
    ),
  );

  const category = await prisma.expenseCategory.findFirst({
    where: { companyId, slug: 'hosting-infrastructure' },
  });

  const now = new Date();
  let created = 0;
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo -= 1) {
    const when = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 12);
    for (const [index, project] of projects.entries()) {
      const gross = (4000 + index * 2500 + (5 - monthsAgo) * 900).toFixed(2);
      const fee = (Number(gross) * 0.0236).toFixed(2);
      await prisma.transaction.create({
        data: {
          companyId,
          projectId: project.id,
          provider: 'MANUAL_BANK',
          type: 'MANUAL_ENTRY',
          status: 'SUCCEEDED',
          grossAmount: gross,
          feeAmount: fee,
          currency: 'INR',
          occurredAt: when,
          source: 'MANUAL',
          createdById,
          description: '[DEMO] Seeded revenue record',
        },
      });
      created += 1;
    }

    if (category) {
      await prisma.expense.create({
        data: {
          companyId,
          projectId: projects[0]!.id,
          categoryId: category.id,
          vendor: '[DEMO] Cloud Hosting',
          amount: '2400.00',
          currency: 'INR',
          expenseDate: when,
          paymentStatus: 'PAID',
          paidAt: when,
          createdById,
          notes: 'Demo record created by the seed script.',
        },
      });
    }
  }
  console.log(`  demo: ${projects.length} projects, ${created} transactions, 6 expenses`);
}

main()
  .catch((error: unknown) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
