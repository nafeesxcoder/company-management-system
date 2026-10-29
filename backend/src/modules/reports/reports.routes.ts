import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { dateRangeQueryShape } from '../../utils/dates.js';
import * as controller from './reports.controller.js';

export const dashboardRouter: Router = Router();
export const reportsRouter: Router = Router();

dashboardRouter.use(authenticate, companyScope);
reportsRouter.use(authenticate, companyScope);

const reportQuerySchema = dateRangeQueryShape
  .partial()
  .extend({ projectId: z.string().uuid().optional() });

/**
 * @openapi
 * /dashboard:
 *   get:
 *     tags: [Dashboard]
 *     summary: Company financial dashboard
 *     description: >
 *       The authoritative figures. The web dashboard and the Flutter app both
 *       render this response as-is — no client recomputes any total, so the two
 *       can never disagree.
 *
 *       `dataQuality.hasUnconvertedRecords` is true when records exist in a
 *       currency with no recorded exchange rate; those rows are EXCLUDED from
 *       the totals and the client must surface that.
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - { in: query, name: preset, schema: { type: string, enum: [today, yesterday, last7days, last30days, thisMonth, lastMonth, thisQuarter, thisYear, lastYear, allTime, custom] }, description: "Resolved in the company timezone" }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: "Required when preset=custom" }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Dashboard figures, breakdowns and monthly trend
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     summary: { $ref: '#/components/schemas/FinancialSummary' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
dashboardRouter.get('/', validate({ query: reportQuerySchema }), controller.dashboardHandler);

/**
 * @openapi
 * /reports/profit-loss:
 *   get:
 *     tags: [Reports]
 *     summary: Profit and loss statement
 *     description: Includes a `definitions` block so every figure can be audited rather than trusted.
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - { in: query, name: preset, schema: { type: string } }
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: P&L statement }
 */
reportsRouter.get('/profit-loss', validate({ query: reportQuerySchema }), controller.profitLossHandler);

/**
 * @openapi
 * /reports/export/transactions:
 *   get:
 *     tags: [Reports]
 *     summary: Export transactions as CSV
 *     description: >
 *       UTF-8 with a BOM so Excel renders ₹ correctly. Cells beginning with
 *       =, +, - or @ are neutralised against spreadsheet formula injection.
 *       Rows that could not be converted to the base currency are marked
 *       `NOT_CONVERTED` rather than being given a guessed value.
 *     responses:
 *       200:
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema: { type: string }
 */
reportsRouter.get(
  '/export/transactions',
  validate({ query: reportQuerySchema }),
  controller.exportTransactionsHandler,
);

/**
 * @openapi
 * /reports/export/expenses:
 *   get:
 *     tags: [Reports]
 *     summary: Export expenses as CSV
 *     responses:
 *       200:
 *         description: CSV file
 *         content:
 *           text/csv:
 *             schema: { type: string }
 */
reportsRouter.get(
  '/export/expenses',
  validate({ query: reportQuerySchema }),
  controller.exportExpensesHandler,
);
