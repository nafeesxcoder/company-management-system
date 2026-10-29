import type { Request, Response } from 'express';
import { asyncHandler, ok } from '../../utils/http.js';
import { requireCompanyContext } from '../../middleware/company-scope.js';
import { resolveDateRange, type DateRangeQuery } from '../../utils/dates.js';
import { csvFilename, toCsv } from '../../utils/csv.js';
import * as service from './reports.service.js';

type ReportQuery = Partial<DateRangeQuery> & { projectId?: string };

function rangeArgs(req: Request) {
  const { companyId, baseCurrency, timezone } = requireCompanyContext(req);
  const query = req.query as unknown as ReportQuery;
  const range = resolveDateRange(query, timezone);

  return {
    companyId,
    baseCurrency,
    timezone,
    range,
    ...(query.projectId ? { projectId: query.projectId } : {}),
  };
}

export const dashboardHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await service.getDashboard(rangeArgs(req)));
});

export const profitLossHandler = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await service.getProfitLoss(rangeArgs(req)));
});

export const exportTransactionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const args = rangeArgs(req);
  const rows = await service.getTransactionExportRows(args);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${csvFilename('transactions', args.range)}"`,
  );
  return res.send(toCsv(rows));
});

export const exportExpensesHandler = asyncHandler(async (req: Request, res: Response) => {
  const args = rangeArgs(req);
  const rows = await service.getExpenseExportRows(args);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('expenses', args.range)}"`);
  return res.send(toCsv(rows));
});
