import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireCompanyContext, requireFinancialWrite, requireUser } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { auditFromRequest } from '../../services/audit.service.js';
import { dateRangeQueryShape, resolveDateRange } from '../../utils/dates.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { positiveMoneySchema } from '../transactions/transactions.validators.js';
import * as service from './profit-sharing.service.js';

export const profitSharingRouter: Router = Router();
export const payoutsRouter: Router = Router();

profitSharingRouter.use(authenticate, companyScope);
payoutsRouter.use(authenticate, companyScope);

const percentageSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'Percentage must be a decimal string such as "50" or "33.3333"');

const setSharesSchema = z.object({
  shares: z
    .array(z.object({ userId: z.string().uuid(), percentage: percentageSchema }))
    .min(1, 'At least one partner share is required')
    .max(20),
  effectiveFrom: z.string().date(),
  note: z.string().trim().max(500).optional(),
});

const createPayoutSchema = z.object({
  userId: z.string().uuid(),
  amount: positiveMoneySchema,
  currency: z.string().length(3).toUpperCase().optional(),
  payoutDate: z.string().date(),
  method: z.string().trim().max(80).optional(),
  reference: z.string().trim().max(191).optional(),
  notes: z.string().trim().max(2000).optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  status: z.enum(['PENDING', 'PAID', 'CANCELED']).optional(),
});

const updatePayoutSchema = z
  .object({
    amount: positiveMoneySchema.optional(),
    payoutDate: z.string().date().optional(),
    status: z.enum(['PENDING', 'PAID', 'CANCELED']).optional(),
    method: z.string().trim().max(80).nullish(),
    reference: z.string().trim().max(191).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

/**
 * @openapi
 * /profit-sharing:
 *   get:
 *     tags: [Profit Sharing]
 *     summary: Profit-share statement for a period
 *     description: >
 *       Returns each partner's CALCULATED share alongside what has ACTUALLY
 *       been paid, and the outstanding difference. A calculated share is never
 *       treated as money already paid.
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - { in: query, name: preset, schema: { type: string } }
 *     responses:
 *       200: { description: Statement with per-partner shares, payouts and outstanding amounts }
 */
profitSharingRouter.get(
  '/',
  validate({ query: dateRangeQueryShape.partial() }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, baseCurrency, timezone } = requireCompanyContext(req);
    const range = resolveDateRange(req.query as never, timezone);
    return ok(res, await service.getProfitShareStatement({ companyId, baseCurrency, range }));
  }),
);

/**
 * @openapi
 * /profit-sharing/config:
 *   get:
 *     tags: [Profit Sharing]
 *     summary: The split currently in force
 *     responses:
 *       200: { description: Active share configuration }
 */
profitSharingRouter.get(
  '/config',
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const shares = await service.getActiveShares(companyId);
    return ok(
      res,
      shares.map((s) => ({ ...s, percentage: s.percentage.toString() })),
    );
  }),
);

/**
 * @openapi
 * /profit-sharing/history:
 *   get:
 *     tags: [Profit Sharing]
 *     summary: Every past and present split configuration
 *     responses:
 *       200: { description: Versioned configuration history }
 */
profitSharingRouter.get(
  '/history',
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const history = await service.listShareHistory(companyId);
    return ok(
      res,
      history.map((h) => ({ ...h, percentage: h.percentage.toString() })),
    );
  }),
);

/**
 * @openapi
 * /profit-sharing/config:
 *   put:
 *     tags: [Profit Sharing]
 *     summary: Set the profit split from a date onwards
 *     description: >
 *       Percentages must total exactly 100. Earlier configurations are closed
 *       off rather than deleted, so historical statements keep using the split
 *       that was actually in force at the time.
 *     responses:
 *       200: { description: Configuration saved }
 *       422: { description: Percentages do not total 100, or a user is not an active member }
 */
profitSharingRouter.put(
  '/config',
  requireAdmin,
  validate({ body: setSharesSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const user = requireUser(req);
    const input = req.body as z.infer<typeof setSharesSchema>;

    const before = await service.getActiveShares(companyId);
    const shares = await service.setShares({ companyId, createdById: user.id, input });

    await auditFromRequest(req, {
      action: 'profit_share.update',
      entityType: 'PartnerProfitShare',
      entityId: companyId,
      summary: `Profit split set from ${input.effectiveFrom}: ${input.shares
        .map((s) => `${s.percentage}%`)
        .join(' / ')}`,
      before: before.map((b) => ({ userId: b.userId, percentage: b.percentage.toString() })),
      after: input.shares,
    });

    return ok(
      res,
      shares.map((s) => ({ ...s, percentage: s.percentage.toString() })),
    );
  }),
);

/**
 * @openapi
 * /payouts:
 *   get:
 *     tags: [Profit Sharing]
 *     summary: Actual partner payout history
 *     parameters:
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: userId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Paginated payouts }
 */
payoutsRouter.get(
  '/',
  validate({ query: paginationQuerySchema.extend({ userId: z.string().uuid().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const query = req.query as unknown as { page: number; pageSize: number; userId?: string };

    const { items, totalItems } = await service.listPayouts({ companyId, ...query });
    return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
  }),
);

/**
 * @openapi
 * /payouts:
 *   post:
 *     tags: [Profit Sharing]
 *     summary: Record money actually paid to a partner
 *     description: Recorded in the company base currency so it is comparable with calculated shares.
 *     responses:
 *       201: { description: Payout recorded }
 */
payoutsRouter.post(
  '/',
  requireFinancialWrite,
  validate({ body: createPayoutSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, baseCurrency } = requireCompanyContext(req);
    const user = requireUser(req);

    const payout = await service.createPayout({
      companyId,
      baseCurrency,
      createdById: user.id,
      input: req.body as never,
    });

    await auditFromRequest(req, {
      action: 'payout.create',
      entityType: 'PartnerPayout',
      entityId: payout.id,
      summary: `Recorded payout of ${payout.currency} ${payout.amount.toString()} to ${payout.partner.fullName}`,
      after: payout,
    });

    return created(res, { ...payout, amount: payout.amount.toString() });
  }),
);

/**
 * @openapi
 * /payouts/{id}:
 *   patch:
 *     tags: [Profit Sharing]
 *     summary: Correct a recorded payout
 *     responses:
 *       200: { description: Updated }
 */
payoutsRouter.patch(
  '/:id',
  requireFinancialWrite,
  validate({ params: z.object({ id: z.string().uuid() }), body: updatePayoutSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };

    const { before, after } = await service.updatePayout({
      companyId,
      payoutId: id,
      input: req.body as never,
    });

    await auditFromRequest(req, {
      action: 'payout.update',
      entityType: 'PartnerPayout',
      entityId: id,
      summary: `Updated payout ${id}`,
      before,
      after,
    });

    return ok(res, { ...after, amount: after.amount.toString() });
  }),
);

/**
 * @openapi
 * /payouts/{id}:
 *   delete:
 *     tags: [Profit Sharing]
 *     summary: Delete a payout recorded in error
 *     responses:
 *       204: { description: Deleted }
 */
payoutsRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };

    const deleted = await service.deletePayout(companyId, id);

    await auditFromRequest(req, {
      action: 'payout.delete',
      entityType: 'PartnerPayout',
      entityId: id,
      summary: `Deleted payout of ${deleted.currency} ${deleted.amount.toString()}`,
      before: deleted,
    });

    return noContent(res);
  }),
);
