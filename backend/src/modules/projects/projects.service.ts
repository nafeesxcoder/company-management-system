import { prisma } from '../../config/prisma.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { buildOrderBy, toSkipTake } from '../../utils/pagination.js';
import { serializeMoney } from '../../utils/money.js';
import { toDateOnly } from '../../utils/dates.js';
import { calculateTotals } from '../reports/calculations.js';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from './projects.validators.js';

/**
 * Projects are the unit every financial record hangs off.
 *
 * Registering a project here does NOT mean its source code lives in this
 * system. Each project keeps running on its own server, domain and repository;
 * this record is the identity that payments and expenses attribute to.
 */

const SORTABLE = ['createdAt', 'name', 'code', 'launchDate', 'status', 'updatedAt'] as const;

export async function listProjects(companyId: string, query: ListProjectsQuery) {
  const { skip, take } = toSkipTake(query);

  const where = {
    companyId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.revenueModel ? { revenueModel: query.revenueModel } : {}),
    ...(query.includeArchived ? {} : { archivedAt: null }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { code: { contains: query.search } },
            { description: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [items, totalItems] = await Promise.all([
    prisma.project.findMany({
      where,
      skip,
      take,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, 'createdAt'),
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        type: true,
        status: true,
        revenueModel: true,
        currency: true,
        projectUrl: true,
        repositoryUrl: true,
        launchDate: true,
        notes: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { transactions: true, expenses: true, subscriptions: true } },
      },
    }),
    prisma.project.count({ where }),
  ]);

  return { items, totalItems };
}

export async function getProject(companyId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    // companyId in the WHERE is what enforces isolation: another company's id
    // simply does not match, so it 404s rather than leaking existence.
    where: { id: projectId, companyId },
    include: {
      createdBy: { select: { id: true, fullName: true, email: true } },
      productMappings: {
        where: { isActive: true },
        select: {
          id: true,
          provider: true,
          externalProductId: true,
          label: true,
          providerAccount: { select: { id: true, label: true } },
        },
      },
      _count: { select: { transactions: true, expenses: true, subscriptions: true, invoices: true } },
    },
  });

  if (!project) throw notFound('Project');
  return project;
}

/** Project detail plus its own financial summary, in the company base currency. */
export async function getProjectWithFinancials(
  companyId: string,
  projectId: string,
  baseCurrency: string,
  range?: { from: Date; to: Date },
) {
  const project = await getProject(companyId, projectId);

  const dateFilter = range ? { gte: range.from, lte: range.to } : undefined;

  const [transactions, expenses] = await Promise.all([
    prisma.transaction.findMany({
      where: { companyId, projectId, ...(dateFilter ? { occurredAt: dateFilter } : {}) },
      select: {
        id: true,
        status: true,
        grossAmount: true,
        feeAmount: true,
        refundedAmount: true,
        currency: true,
        exchangeRateToBase: true,
        occurredAt: true,
      },
    }),
    prisma.expense.findMany({
      where: { companyId, projectId, ...(range ? { expenseDate: { gte: range.from, lte: range.to } } : {}) },
      select: {
        id: true,
        paymentStatus: true,
        amount: true,
        taxAmount: true,
        currency: true,
        exchangeRateToBase: true,
        excludeFromProfit: true,
      },
    }),
  ]);

  const refunds = await prisma.refund.findMany({
    where: { transaction: { companyId, projectId }, ...(dateFilter ? { occurredAt: dateFilter } : {}) },
    select: { id: true, status: true, amount: true, feeRefunded: true, currency: true, transactionId: true },
  });

  const totals = calculateTotals(
    {
      transactions: transactions as never,
      refunds: refunds as never,
      expenses: expenses as never,
    },
    baseCurrency,
  );

  return {
    project,
    financials: {
      currency: baseCurrency,
      grossRevenue: serializeMoney(totals.grossRevenue, baseCurrency),
      totalRefunds: serializeMoney(totals.totalRefunds, baseCurrency),
      netRevenue: serializeMoney(totals.netRevenue, baseCurrency),
      processingFees: serializeMoney(totals.processingFees, baseCurrency),
      totalExpenses: serializeMoney(totals.totalExpenses, baseCurrency),
      eligibleExpenses: serializeMoney(totals.eligibleExpenses, baseCurrency),
      netProfit: serializeMoney(totals.netProfit, baseCurrency),
      pendingPayments: serializeMoney(totals.pendingPayments, baseCurrency),
      transactionCount: totals.transactionCount,
      expenseCount: totals.expenseCount,
      unconvertedRecords: totals.unconvertedRecords,
    },
  };
}

export async function createProject(params: {
  companyId: string;
  createdById: string;
  input: CreateProjectInput;
}) {
  const { companyId, createdById, input } = params;

  const duplicate = await prisma.project.findUnique({
    where: { companyId_code: { companyId, code: input.code } },
    select: { id: true },
  });
  if (duplicate) {
    throw conflict(`A project with code "${input.code}" already exists in this company`);
  }

  return prisma.project.create({
    data: {
      companyId,
      createdById,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      status: input.status,
      revenueModel: input.revenueModel,
      currency: input.currency,
      projectUrl: input.projectUrl ?? null,
      repositoryUrl: input.repositoryUrl ?? null,
      launchDate: input.launchDate ? toDateOnly(input.launchDate) : null,
      notes: input.notes ?? null,
    },
  });
}

export async function updateProject(params: {
  companyId: string;
  projectId: string;
  input: UpdateProjectInput;
}) {
  const { companyId, projectId, input } = params;

  const existing = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!existing) throw notFound('Project');

  if (input.code && input.code !== existing.code) {
    const clash = await prisma.project.findUnique({
      where: { companyId_code: { companyId, code: input.code } },
      select: { id: true },
    });
    if (clash) throw conflict(`A project with code "${input.code}" already exists in this company`);
  }

  // Changing the currency after money has been recorded would make historical
  // figures ambiguous, so it is blocked once records exist.
  if (input.currency && input.currency !== existing.currency) {
    const recordCount = await prisma.transaction.count({ where: { projectId } });
    if (recordCount > 0) {
      throw unprocessable(
        `Cannot change the currency of a project that already has ${recordCount} transaction(s). ` +
          'Create a new project instead, so historical figures stay meaningful.',
      );
    }
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.revenueModel !== undefined ? { revenueModel: input.revenueModel } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.projectUrl !== undefined ? { projectUrl: input.projectUrl ?? null } : {}),
      ...(input.repositoryUrl !== undefined ? { repositoryUrl: input.repositoryUrl ?? null } : {}),
      ...(input.launchDate !== undefined
        ? { launchDate: input.launchDate ? toDateOnly(input.launchDate) : null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    },
  });

  return { before: existing, after: updated };
}

/** Archiving is reversible and preserves every financial record. */
export async function archiveProject(companyId: string, projectId: string) {
  const existing = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!existing) throw notFound('Project');
  if (existing.archivedAt) throw conflict('This project is already archived');

  return prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date(), status: 'ARCHIVED' },
  });
}

export async function restoreProject(companyId: string, projectId: string) {
  const existing = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!existing) throw notFound('Project');
  if (!existing.archivedAt) throw conflict('This project is not archived');

  return prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: null, status: 'ACTIVE' },
  });
}

/**
 * Hard delete. Refused whenever financial records exist — deleting revenue
 * history to tidy a list is never the right outcome. Archive instead.
 */
export async function deleteProject(companyId: string, projectId: string) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    include: {
      _count: { select: { transactions: true, expenses: true, subscriptions: true, invoices: true } },
    },
  });
  if (!existing) throw notFound('Project');

  const { transactions, expenses, subscriptions, invoices } = existing._count;
  const total = transactions + expenses + subscriptions + invoices;
  if (total > 0) {
    throw conflict(
      `Cannot delete a project with ${total} financial record(s) attached ` +
        `(${transactions} transactions, ${expenses} expenses, ${subscriptions} subscriptions, ${invoices} invoices). ` +
        'Archive it instead to keep the history intact.',
    );
  }

  await prisma.project.delete({ where: { id: projectId } });
  return existing;
}
