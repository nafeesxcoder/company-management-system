import type { Request, Response } from 'express';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { requireCompanyContext, requireUser } from '../../middleware/company-scope.js';
import { auditFromRequest } from '../../services/audit.service.js';
import * as service from './transactions.service.js';
import type {
  AssignProjectInput,
  CreateRefundInput,
  CreateTransactionInput,
  ListTransactionsQuery,
  UpdateTransactionInput,
} from './transactions.validators.js';

export const listTransactionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const query = req.query as unknown as ListTransactionsQuery;

  const { items, totalItems } = await service.listTransactions(companyId, query);
  return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
});

export const getTransactionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  return ok(res, await service.getTransaction(companyId, id));
});

export const createTransactionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, baseCurrency } = requireCompanyContext(req);
  const user = requireUser(req);
  const input = req.body as CreateTransactionInput;

  const txn = await service.createTransaction({
    companyId,
    baseCurrency,
    createdById: user.id,
    input,
  });

  await auditFromRequest(req, {
    action: 'transaction.create',
    entityType: 'Transaction',
    entityId: txn.id as string,
    summary: `Recorded ${txn.currency} ${txn.grossAmount} income (${input.type})`,
    after: txn,
  });

  return created(res, txn);
});

export const updateTransactionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, baseCurrency } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateTransactionInput;

  const { before, after } = await service.updateTransaction({
    companyId,
    baseCurrency,
    transactionId: id,
    input,
  });

  await auditFromRequest(req, {
    action: 'transaction.update',
    entityType: 'Transaction',
    entityId: id,
    summary: `Updated transaction ${id}`,
    before,
    after,
  });

  return ok(res, after);
});

export const deleteTransactionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const deleted = await service.deleteTransaction(companyId, id);

  await auditFromRequest(req, {
    action: 'transaction.delete',
    entityType: 'Transaction',
    entityId: id,
    summary: `Deleted transaction of ${deleted.currency} ${deleted.grossAmount}`,
    before: deleted,
  });

  return noContent(res);
});

export const assignProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  const input = req.body as AssignProjectInput;

  const { before, after } = await service.assignProject({
    companyId,
    transactionId: id,
    projectId: input.projectId,
    ...(input.note ? { note: input.note } : {}),
  });

  await auditFromRequest(req, {
    action: 'transaction.reassign_project',
    entityType: 'Transaction',
    entityId: id,
    summary: `Attributed transaction ${id} to project ${input.projectId}`,
    before: { projectId: before.projectId, reviewStatus: before.reviewStatus },
    after: { projectId: after.projectId, reviewStatus: after.reviewStatus },
  });

  return ok(res, after);
});

export const createRefundHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  const input = req.body as CreateRefundInput;

  const result = await service.createRefund({
    companyId,
    transactionId: id,
    createdById: user.id,
    input,
  });

  await auditFromRequest(req, {
    action: 'refund.create',
    entityType: 'Refund',
    entityId: result.refund.id,
    summary:
      `Refunded ${result.refund.currency} ${result.refund.amount} ` +
      `(${result.refund.isPartial ? 'partial' : 'full'}) on transaction ${id}`,
    after: result.refund,
  });

  return created(res, result);
});

export const listRefundsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const query = req.query as unknown as {
    page: number;
    pageSize: number;
    projectId?: string;
    from?: string;
    to?: string;
  };

  const { items, totalItems } = await service.listRefunds(companyId, query);
  return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
});

export const deleteRefundHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { refundId } = req.params as { refundId: string };

  const result = await service.deleteRefund({ companyId, refundId });

  await auditFromRequest(req, {
    action: 'refund.update',
    entityType: 'Refund',
    entityId: refundId,
    summary: `Reversed refund ${refundId}`,
  });

  return ok(res, result);
});
