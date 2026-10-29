import type { Request, Response } from 'express';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { requireCompanyContext, requireUser } from '../../middleware/company-scope.js';
import { auditFromRequest } from '../../services/audit.service.js';
import * as service from './expenses.service.js';
import type {
  CreateCategoryInput,
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateCategoryInput,
  UpdateExpenseInput,
} from './expenses.validators.js';

export const listExpensesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const query = req.query as unknown as ListExpensesQuery;

  const { items, totalItems } = await service.listExpenses(companyId, query);
  return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
});

export const getExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  return ok(res, await service.getExpense(companyId, id));
});

export const createExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, baseCurrency } = requireCompanyContext(req);
  const user = requireUser(req);
  const input = req.body as CreateExpenseInput;

  const expense = await service.createExpense({ companyId, baseCurrency, createdById: user.id, input });

  await auditFromRequest(req, {
    action: 'expense.create',
    entityType: 'Expense',
    entityId: expense.id as string,
    summary: `Recorded ${expense.currency} ${expense.totalAmount} expense to ${expense.vendor}`,
    after: expense,
  });

  return created(res, expense);
});

export const updateExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, baseCurrency } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateExpenseInput;

  const { before, after } = await service.updateExpense({
    companyId,
    baseCurrency,
    expenseId: id,
    input,
  });

  await auditFromRequest(req, {
    action: 'expense.update',
    entityType: 'Expense',
    entityId: id,
    summary: `Updated expense ${id}`,
    before,
    after,
  });

  return ok(res, after);
});

export const deleteExpenseHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const deleted = await service.deleteExpense(companyId, id);

  await auditFromRequest(req, {
    action: 'expense.delete',
    entityType: 'Expense',
    entityId: id,
    summary: `Deleted ${deleted.currency} ${deleted.totalAmount} expense to ${deleted.vendor}`,
    before: deleted,
  });

  return noContent(res);
});

export const listCategoriesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const includeInactive = req.query.includeInactive === 'true';
  return ok(res, await service.listCategories(companyId, includeInactive));
});

export const createCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const input = req.body as CreateCategoryInput;

  const category = await service.createCategory(companyId, input);

  await auditFromRequest(req, {
    action: 'expense_category.create',
    entityType: 'ExpenseCategory',
    entityId: category.id,
    summary: `Created expense category "${category.name}"`,
    after: category,
  });

  return created(res, category);
});

export const updateCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateCategoryInput;

  const category = await service.updateCategory(companyId, id, input);

  await auditFromRequest(req, {
    action: 'expense_category.update',
    entityType: 'ExpenseCategory',
    entityId: id,
    summary: `Updated expense category "${category.name}"`,
    after: category,
  });

  return ok(res, category);
});

export const deleteCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const category = await service.deleteCategory(companyId, id);

  await auditFromRequest(req, {
    action: 'expense_category.update',
    entityType: 'ExpenseCategory',
    entityId: id,
    summary: `Deleted expense category "${category.name}"`,
    before: category,
  });

  return noContent(res);
});
