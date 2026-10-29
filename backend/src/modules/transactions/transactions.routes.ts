import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireFinancialWrite } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimit } from '../../middleware/rate-limit.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import * as controller from './transactions.controller.js';
import {
  assignProjectSchema,
  createRefundSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
  updateTransactionSchema,
} from './transactions.validators.js';

export const transactionsRouter: Router = Router();
export const refundsRouter: Router = Router();

transactionsRouter.use(authenticate, companyScope);
refundsRouter.use(authenticate, companyScope);

/**
 * @openapi
 * /transactions:
 *   get:
 *     tags: [Transactions]
 *     summary: List income and payment records
 *     description: >
 *       Money fields are decimal strings. `netAmount` (gross − refunds − fees)
 *       is computed server-side so clients never do money arithmetic.
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, SUCCEEDED, FAILED, CANCELED, REFUNDED, PARTIALLY_REFUNDED, DISPUTED] } }
 *       - { in: query, name: provider, schema: { type: string, enum: [STRIPE, RAZORPAY, GOOGLE_PLAY, MANUAL_BANK, OTHER] } }
 *       - { in: query, name: reviewStatus, schema: { type: string, enum: [NOT_REQUIRED, NEEDS_REVIEW, RESOLVED] } }
 *       - { in: query, name: from, schema: { type: string, format: date } }
 *       - { in: query, name: to, schema: { type: string, format: date } }
 *     responses:
 *       200: { description: Paginated transactions }
 */
transactionsRouter.get(
  '/',
  validate({ query: listTransactionsQuerySchema }),
  controller.listTransactionsHandler,
);

/**
 * @openapi
 * /transactions/{id}:
 *   get:
 *     tags: [Transactions]
 *     summary: One transaction with its refund history
 *     responses:
 *       200: { description: Transaction }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
transactionsRouter.get(
  '/:id',
  validate({ params: transactionIdParamSchema }),
  controller.getTransactionHandler,
);

/**
 * @openapi
 * /transactions:
 *   post:
 *     tags: [Transactions]
 *     summary: Record income manually
 *     description: >
 *       For projects with no payment gateway, or for bank transfers and
 *       milestone payments. Amounts are decimal STRINGS. A currency other than
 *       the company base currency requires `exchangeRateToBase`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId, grossAmount, currency, occurredAt]
 *             properties:
 *               projectId: { type: string, format: uuid }
 *               grossAmount: { $ref: '#/components/schemas/Money' }
 *               feeAmount: { $ref: '#/components/schemas/Money' }
 *               currency: { type: string, example: INR }
 *               exchangeRateToBase: { type: string, example: "83.25" }
 *               occurredAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Transaction recorded }
 *       409: { description: This provider reference is already recorded }
 *       422: { description: Missing exchange rate, or fee exceeds gross }
 */
transactionsRouter.post(
  '/',
  requireFinancialWrite,
  writeRateLimit,
  validate({ body: createTransactionSchema }),
  controller.createTransactionHandler,
);

/**
 * @openapi
 * /transactions/{id}:
 *   patch:
 *     tags: [Transactions]
 *     summary: Correct a transaction
 *     responses:
 *       200: { description: Updated }
 *       422: { description: Change would contradict recorded refunds }
 */
transactionsRouter.patch(
  '/:id',
  requireFinancialWrite,
  writeRateLimit,
  validate({ params: transactionIdParamSchema, body: updateTransactionSchema }),
  controller.updateTransactionHandler,
);

/**
 * @openapi
 * /transactions/{id}:
 *   delete:
 *     tags: [Transactions]
 *     summary: Delete a manually-entered transaction
 *     description: Webhook-ingested transactions can never be deleted — record a refund instead.
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Automated record, or refunds are attached }
 */
transactionsRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: transactionIdParamSchema }),
  controller.deleteTransactionHandler,
);

/**
 * @openapi
 * /transactions/{id}/assign-project:
 *   post:
 *     tags: [Transactions]
 *     summary: Attribute a payment that needs review to a project
 *     description: >
 *       Used for payments the ingestion pipeline could not map to a project with
 *       confidence. They are flagged rather than guessed at.
 *     responses:
 *       200: { description: Attributed }
 */
transactionsRouter.post(
  '/:id/assign-project',
  requireFinancialWrite,
  validate({ params: transactionIdParamSchema, body: assignProjectSchema }),
  controller.assignProjectHandler,
);

/**
 * @openapi
 * /transactions/{id}/refunds:
 *   post:
 *     tags: [Refunds]
 *     summary: Record a full or partial refund
 *     description: >
 *       Atomic: the refund row, the transaction's running refunded total and its
 *       derived status all change together. Refunding more than the remaining
 *       balance is rejected.
 *     responses:
 *       201: { description: Refund recorded }
 *       422: { description: Refund exceeds the remaining refundable amount }
 */
transactionsRouter.post(
  '/:id/refunds',
  requireFinancialWrite,
  writeRateLimit,
  validate({ params: transactionIdParamSchema, body: createRefundSchema }),
  controller.createRefundHandler,
);

/**
 * @openapi
 * /refunds:
 *   get:
 *     tags: [Refunds]
 *     summary: List refunds across the company
 *     parameters:
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: projectId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Paginated refunds }
 */
refundsRouter.get(
  '/',
  validate({
    query: paginationQuerySchema.extend({
      projectId: z.string().uuid().optional(),
      from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
      to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    }),
  }),
  controller.listRefundsHandler,
);

/**
 * @openapi
 * /refunds/{refundId}:
 *   delete:
 *     tags: [Refunds]
 *     summary: Reverse a refund recorded in error
 *     description: Only manual refunds. Provider-reported refunds are immutable.
 *     responses:
 *       200: { description: Refund reversed, transaction restored }
 *       409: { description: Refund came from a provider webhook }
 */
refundsRouter.delete(
  '/:refundId',
  requireAdmin,
  validate({ params: z.object({ refundId: z.string().uuid() }) }),
  controller.deleteRefundHandler,
);
