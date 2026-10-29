import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { projectsRouter } from '../modules/projects/projects.routes.js';
import { refundsRouter, transactionsRouter } from '../modules/transactions/transactions.routes.js';
import { expenseCategoriesRouter, expensesRouter } from '../modules/expenses/expenses.routes.js';
import { dashboardRouter, reportsRouter } from '../modules/reports/reports.routes.js';
import { payoutsRouter, profitSharingRouter } from '../modules/profit-sharing/profit-sharing.routes.js';
import { providersRouter } from '../modules/payment-providers/providers.routes.js';
import { webhooksRouter } from '../modules/payment-providers/webhooks.routes.js';
import {
  auditLogsRouter,
  companiesRouter,
  membersRouter,
} from '../modules/companies/companies.routes.js';

/**
 * API v1 router.
 *
 * Each module owns its routes, controller, service and validators; this file
 * only mounts them. Every route except /auth/* and /ping sits behind
 * `authenticate` + `companyScope`, applied inside the module router.
 */
export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/refunds', refundsRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/expense-categories', expenseCategoriesRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/profit-sharing', profitSharingRouter);
apiRouter.use('/payouts', payoutsRouter);
apiRouter.use('/payment-providers', providersRouter);
apiRouter.use('/companies', companiesRouter);
apiRouter.use('/members', membersRouter);
apiRouter.use('/audit-logs', auditLogsRouter);

// Unauthenticated, signature-verified. Mounted last so no auth middleware
// above can accidentally shadow it; the raw-body capture for these paths is
// installed in app.ts BEFORE the JSON parser.
apiRouter.use('/webhooks', webhooksRouter);

/**
 * @openapi
 * /ping:
 *   get:
 *     tags: [Auth]
 *     summary: Liveness probe for the versioned API
 *     security: []
 *     responses:
 *       200: { description: API is reachable }
 */
apiRouter.get('/ping', (_req, res) => {
  res.json({ data: { status: 'ok', timestamp: new Date().toISOString() } });
});
