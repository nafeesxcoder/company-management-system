import { prisma } from '../../config/prisma.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { buildOrderBy, toSkipTake } from '../../utils/pagination.js';
import { serializeMoney, toDecimal } from '../../utils/money.js';
import { toDateOnly } from '../../utils/dates.js';
import type {
  CreateCategoryInput,
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateCategoryInput,
  UpdateExpenseInput,
} from './expenses.validators.js';

const SORTABLE = ['expenseDate', 'amount', 'createdAt', 'vendor', 'paymentStatus'] as const;

const EXPENSE_SELECT = {
  id: true,
  projectId: true,
  categoryId: true,
  vendor: true,
  description: true,
  amount: true,
  taxAmount: true,
  currency: true,
  exchangeRateToBase: true,
  expenseDate: true,
  paymentStatus: true,
  paidAt: true,
  receiptUrl: true,
  notes: true,
  excludeFromProfit: true,
  isRecurring: true,
  recurringInterval: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, name: true, slug: true, color: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const;

function serializeExpense<
  T extends { amount: unknown; taxAmount: unknown; currency: string; exchangeRateToBase?: unknown },
>(expense: T) {
  const amount = toDecimal(expense.amount as never);
  const tax = toDecimal(expense.taxAmount as never);
  return {
    ...expense,
    amount: serializeMoney(amount, expense.currency),
    taxAmount: serializeMoney(tax, expense.currency),
    totalAmount: serializeMoney(amount.plus(tax), expense.currency),
    exchangeRateToBase: expense.exchangeRateToBase ? String(expense.exchangeRateToBase) : null,
  };
}

function assertConvertible(currency: string, baseCurrency: string, rate: string | null | undefined): void {
  if (currency !== baseCurrency && !rate) {
    throw unprocessable(
      `An expense in ${currency} needs "exchangeRateToBase" because the company reports in ${baseCurrency}.`,
      { currency, baseCurrency },
    );
  }
}

export async function listExpenses(companyId: string, query: ListExpensesQuery) {
  const { skip, take } = toSkipTake(query);

  const where = {
    companyId,
    ...(query.companyWideOnly ? { projectId: null } : query.projectId ? { projectId: query.projectId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
    ...(query.currency ? { currency: query.currency } : {}),
    ...(query.vendor ? { vendor: { contains: query.vendor } } : {}),
    ...(query.from || query.to
      ? {
          expenseDate: {
            ...(query.from ? { gte: toDateOnly(query.from) } : {}),
            ...(query.to ? { lte: toDateOnly(query.to) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { vendor: { contains: query.search } },
            { description: { contains: query.search } },
            { notes: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [items, totalItems] = await Promise.all([
    prisma.expense.findMany({
      where,
      skip,
      take,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, 'expenseDate'),
      select: EXPENSE_SELECT,
    }),
    prisma.expense.count({ where }),
  ]);

  return { items: items.map(serializeExpense), totalItems };
}

export async function getExpense(companyId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, companyId },
    select: EXPENSE_SELECT,
  });
  if (!expense) throw notFound('Expense');
  return serializeExpense(expense);
}

export async function createExpense(params: {
  companyId: string;
  baseCurrency: string;
  createdById: string;
  input: CreateExpenseInput;
}) {
  const { companyId, baseCurrency, createdById, input } = params;

  assertConvertible(input.currency, baseCurrency, input.exchangeRateToBase);

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, companyId },
      select: { id: true },
    });
    if (!project) throw notFound('Project');
  }

  const category = await prisma.expenseCategory.findFirst({
    where: { id: input.categoryId, companyId },
    select: { id: true, isActive: true },
  });
  if (!category) throw notFound('Expense category');
  if (!category.isActive) throw unprocessable('That expense category is archived');

  if (input.isRecurring && !input.recurringInterval) {
    throw unprocessable('A recurring expense needs a recurringInterval');
  }

  const expense = await prisma.expense.create({
    data: {
      companyId,
      projectId: input.projectId ?? null,
      categoryId: input.categoryId,
      vendor: input.vendor,
      description: input.description ?? null,
      amount: input.amount,
      taxAmount: input.taxAmount,
      currency: input.currency,
      exchangeRateToBase: input.exchangeRateToBase ?? null,
      expenseDate: toDateOnly(input.expenseDate),
      paymentStatus: input.paymentStatus,
      paidAt: input.paidAt ? new Date(input.paidAt) : input.paymentStatus === 'PAID' ? new Date() : null,
      receiptUrl: input.receiptUrl ?? null,
      notes: input.notes ?? null,
      excludeFromProfit: input.excludeFromProfit,
      isRecurring: input.isRecurring,
      recurringInterval: input.recurringInterval ?? null,
      source: 'MANUAL',
      createdById,
    },
    select: EXPENSE_SELECT,
  });

  return serializeExpense(expense);
}

export async function updateExpense(params: {
  companyId: string;
  baseCurrency: string;
  expenseId: string;
  input: UpdateExpenseInput;
}) {
  const { companyId, baseCurrency, expenseId, input } = params;

  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, companyId },
    select: EXPENSE_SELECT,
  });
  if (!existing) throw notFound('Expense');

  const nextCurrency = input.currency ?? existing.currency;
  const nextRate =
    input.exchangeRateToBase !== undefined
      ? input.exchangeRateToBase
      : existing.exchangeRateToBase
        ? String(existing.exchangeRateToBase)
        : null;
  assertConvertible(nextCurrency, baseCurrency, nextRate);

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, companyId },
      select: { id: true },
    });
    if (!project) throw notFound('Project');
  }

  if (input.categoryId) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: input.categoryId, companyId },
      select: { id: true },
    });
    if (!category) throw notFound('Expense category');
  }

  const updated = await prisma.expense.update({
    where: { id: expenseId },
    data: {
      ...(input.projectId !== undefined ? { projectId: input.projectId ?? null } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.taxAmount !== undefined ? { taxAmount: input.taxAmount } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.exchangeRateToBase !== undefined
        ? { exchangeRateToBase: input.exchangeRateToBase ?? null }
        : {}),
      ...(input.expenseDate !== undefined ? { expenseDate: toDateOnly(input.expenseDate) } : {}),
      ...(input.paymentStatus !== undefined ? { paymentStatus: input.paymentStatus } : {}),
      ...(input.paidAt !== undefined ? { paidAt: input.paidAt ? new Date(input.paidAt) : null } : {}),
      ...(input.receiptUrl !== undefined ? { receiptUrl: input.receiptUrl ?? null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.excludeFromProfit !== undefined ? { excludeFromProfit: input.excludeFromProfit } : {}),
      ...(input.isRecurring !== undefined ? { isRecurring: input.isRecurring } : {}),
      ...(input.recurringInterval !== undefined
        ? { recurringInterval: input.recurringInterval ?? null }
        : {}),
    },
    select: EXPENSE_SELECT,
  });

  return { before: serializeExpense(existing), after: serializeExpense(updated) };
}

export async function deleteExpense(companyId: string, expenseId: string) {
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, companyId },
    select: EXPENSE_SELECT,
  });
  if (!existing) throw notFound('Expense');

  await prisma.expense.delete({ where: { id: expenseId } });
  return serializeExpense(existing);
}

// --- Categories -------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export async function listCategories(companyId: string, includeInactive = false) {
  return prisma.expenseCategory.findMany({
    where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      isSystem: true,
      isActive: true,
      _count: { select: { expenses: true } },
    },
  });
}

export async function createCategory(companyId: string, input: CreateCategoryInput) {
  const slug = slugify(input.name);
  if (!slug) throw unprocessable('Category name must contain at least one letter or digit');

  const existing = await prisma.expenseCategory.findUnique({
    where: { companyId_slug: { companyId, slug } },
    select: { id: true },
  });
  if (existing) throw conflict(`A category named "${input.name}" already exists`);

  return prisma.expenseCategory.create({
    data: { companyId, name: input.name, slug, color: input.color ?? null, isSystem: false },
  });
}

export async function updateCategory(companyId: string, categoryId: string, input: UpdateCategoryInput) {
  const existing = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, companyId },
  });
  if (!existing) throw notFound('Expense category');

  // System categories can be renamed or recoloured, but not deactivated —
  // historical expenses depend on them remaining selectable.
  if (existing.isSystem && input.isActive === false) {
    throw conflict('Built-in categories cannot be deactivated');
  }

  return prisma.expenseCategory.update({
    where: { id: categoryId },
    data: {
      ...(input.name !== undefined ? { name: input.name, slug: slugify(input.name) } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
}

export async function deleteCategory(companyId: string, categoryId: string) {
  const existing = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, companyId },
    include: { _count: { select: { expenses: true } } },
  });
  if (!existing) throw notFound('Expense category');

  if (existing.isSystem) throw conflict('Built-in categories cannot be deleted');
  if (existing._count.expenses > 0) {
    throw conflict(
      `Cannot delete a category with ${existing._count.expenses} expense(s). Deactivate it instead.`,
    );
  }

  await prisma.expenseCategory.delete({ where: { id: categoryId } });
  return existing;
}
