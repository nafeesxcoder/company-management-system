import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../config/prisma.js';
import { hashPassword } from '../modules/auth/auth.service.js';

/**
 * One-time bootstrap: creates the first company and its Owner account.
 *
 * This exists because there is deliberately no public registration endpoint —
 * a private two-partner financial system must not let anyone self-join. Run it
 * once on a new installation, from a trusted shell:
 *
 *   npm run create:owner
 *
 * It refuses to run if the company already has an Owner, so it cannot be used
 * later to quietly mint a second administrator.
 */

function isStrongEnough(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a digit';
  return null;
}

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
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log('\n=== Create the first Owner account ===\n');

  const existingOwner = await prisma.companyMembership.findFirst({ where: { role: 'OWNER' } });
  if (existingOwner) {
    console.error(
      'An Owner already exists for this installation.\n' +
        'Use the in-app "Team & Permissions" screen to invite additional members.\n',
    );
    rl.close();
    process.exitCode = 1;
    return;
  }

  const companyName = (await rl.question('Company name: ')).trim();
  if (companyName.length < 2) throw new Error('Company name is required');

  const baseCurrency = ((await rl.question('Base currency [INR]: ')).trim() || 'INR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(baseCurrency)) throw new Error('Currency must be a 3-letter ISO code');

  const timezone = (await rl.question('Timezone [Asia/Kolkata]: ')).trim() || 'Asia/Kolkata';
  const fullName = (await rl.question('Your full name: ')).trim();
  if (fullName.length < 2) throw new Error('Full name is required');

  const email = (await rl.question('Your email: ')).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid email address is required');

  const password = await rl.question('Password (min 12 chars, mixed case + digit): ');
  const weakness = isStrongEnough(password);
  if (weakness) throw new Error(weakness);

  const confirm = await rl.question('Confirm password: ');
  if (password !== confirm) throw new Error('Passwords do not match');

  rl.close();

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: companyName, baseCurrency, timezone },
    });

    const user = await tx.user.create({
      data: { email, fullName, passwordHash, timezone, isActive: true },
    });

    await tx.companyMembership.create({
      data: {
        companyId: company.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    await tx.expenseCategory.createMany({
      data: SYSTEM_EXPENSE_CATEGORIES.map((c) => ({ ...c, companyId: company.id, isSystem: true })),
    });

    // 100% to the sole owner for now. Adjust once the second partner joins.
    await tx.partnerProfitShare.create({
      data: {
        companyId: company.id,
        userId: user.id,
        percentage: '100',
        effectiveFrom: new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)),
        createdById: user.id,
        note: 'Initial sole-owner allocation; update when the second partner is added',
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        actorId: user.id,
        action: 'company.update',
        entityType: 'Company',
        entityId: company.id,
        summary: `Company "${companyName}" and Owner account created via bootstrap script`,
      },
    });

    return { company, user };
  });

  console.log('\n  Company: %s [%s]', result.company.name, result.company.id);
  console.log('  Owner:   %s [%s]', result.user.email, result.user.id);
  console.log('  Expense categories: %d', SYSTEM_EXPENSE_CATEGORIES.length);
  console.log('  Profit share: 100%% to the owner — update it when your partner joins.\n');
  console.log('Next: sign in, then invite the second partner from Team & Permissions.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nFailed:', error instanceof Error ? error.message : error, '\n');
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
