import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireFinancialWrite } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimit } from '../../middleware/rate-limit.js';
import * as controller from './expenses.controller.js';
import {
  createCategorySchema,
  createExpenseSchema,
  expenseIdParamSchema,
  listExpensesQuerySchema,
  updateCategorySchema,
  updateExpenseSchema,
} from './expenses.validators.js';

export const expensesRouter: Router = Router();
export const expenseCategoriesRouter: Router = Router();

expensesRouter.use(authenticate, companyScope);
expenseCategoriesRouter.use(authenticate, companyScope);

/**
 * @openapi
 * /expenses:
 *   get:
 *     tags: [Expenses]
 *     summary: List expenses
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: companyWideOnly, schema: { type: boolean }, description: "Only overheads not tied to a project" }
 *       - { in: query, name: categoryId, schema: { type: string, format: uuid } }
 *       - { in: query, name: paymentStatus, schema: { type: string, enum: [PENDING, PAID, OVERDUE, CANCELED] } }
 *     responses:
 *       200: { description: Paginated expenses }
 */
expensesRouter.get('/', validate({ query: listExpensesQuerySchema }), controller.listExpensesHandler);

/**
 * @openapi
 * /expenses/{id}:
 *   get:
 *     tags: [Expenses]
 *     summary: One expense
 *     responses:
 *       200: { description: Expense }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
expensesRouter.get('/:id', validate({ params: expenseIdParamSchema }), controller.getExpenseHandler);

/**
 * @openapi
 * /expenses:
 *   post:
 *     tags: [Expenses]
 *     summary: Record an expense
 *     description: >
 *       Omit `projectId` for a company-wide overhead. Set `excludeFromProfit`
 *       when the cost is already counted elsewhere — a payment gateway fee, for
 *       example, is deducted on the transaction row and would otherwise be
 *       double-counted.
 *     responses:
 *       201: { description: Expense recorded }
 *       422: { description: Missing exchange rate for a foreign currency }
 */
expensesRouter.post(
  '/',
  requireFinancialWrite,
  writeRateLimit,
  validate({ body: createExpenseSchema }),
  controller.createExpenseHandler,
);

/**
 * @openapi
 * /expenses/{id}:
 *   patch:
 *     tags: [Expenses]
 *     summary: Update an expense
 *     responses:
 *       200: { description: Updated }
 */
expensesRouter.patch(
  '/:id',
  requireFinancialWrite,
  writeRateLimit,
  validate({ params: expenseIdParamSchema, body: updateExpenseSchema }),
  controller.updateExpenseHandler,
);

/**
 * @openapi
 * /expenses/{id}:
 *   delete:
 *     tags: [Expenses]
 *     summary: Delete an expense
 *     responses:
 *       204: { description: Deleted }
 */
expensesRouter.delete(
  '/:id',
  requireFinancialWrite,
  validate({ params: expenseIdParamSchema }),
  controller.deleteExpenseHandler,
);

/**
 * @openapi
 * /expense-categories:
 *   get:
 *     tags: [Expenses]
 *     summary: List expense categories
 *     responses:
 *       200: { description: Categories with usage counts }
 */
expenseCategoriesRouter.get('/', controller.listCategoriesHandler);

/**
 * @openapi
 * /expense-categories:
 *   post:
 *     tags: [Expenses]
 *     summary: Create a custom expense category
 *     responses:
 *       201: { description: Category created }
 *       409: { description: A category with that name already exists }
 */
expenseCategoriesRouter.post(
  '/',
  requireFinancialWrite,
  validate({ body: createCategorySchema }),
  controller.createCategoryHandler,
);

/**
 * @openapi
 * /expense-categories/{id}:
 *   patch:
 *     tags: [Expenses]
 *     summary: Rename, recolour or deactivate a category
 *     responses:
 *       200: { description: Updated }
 */
expenseCategoriesRouter.patch(
  '/:id',
  requireFinancialWrite,
  validate({ params: expenseIdParamSchema, body: updateCategorySchema }),
  controller.updateCategoryHandler,
);

/**
 * @openapi
 * /expense-categories/{id}:
 *   delete:
 *     tags: [Expenses]
 *     summary: Delete an unused custom category
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Built-in, or still in use }
 */
expenseCategoriesRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  controller.deleteCategoryHandler,
);
