import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireFinancialWrite } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { writeRateLimit } from '../../middleware/rate-limit.js';
import { dateRangeQueryShape } from '../../utils/dates.js';
import * as controller from './projects.controller.js';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  updateProjectSchema,
} from './projects.validators.js';

export const projectsRouter: Router = Router();

// Every route below requires a valid token AND an active company membership.
projectsRouter.use(authenticate, companyScope);

/**
 * @openapi
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: List projects for the current company
 *     parameters:
 *       - $ref: '#/components/parameters/CompanyId'
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: status, schema: { type: string, enum: [PLANNING, ACTIVE, PAUSED, COMPLETED, ARCHIVED] } }
 *       - { in: query, name: type, schema: { type: string, enum: [SAAS, WEB_APPLICATION, MOBILE_APPLICATION, CLIENT_WEBSITE, CUSTOM_SOFTWARE, OTHER] } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: includeArchived, schema: { type: boolean, default: false } }
 *     responses:
 *       200: { description: Paginated project list }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
projectsRouter.get('/', validate({ query: listProjectsQuerySchema }), controller.listProjectsHandler);

/**
 * @openapi
 * /projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: Project detail with its financial summary
 *     description: >
 *       Pass a `preset` (or `custom` with `from`/`to`) to scope the financial
 *       summary to a date range. Figures are in the company base currency.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: query, name: preset, schema: { type: string, enum: [today, yesterday, last7days, last30days, thisMonth, lastMonth, thisQuarter, thisYear, lastYear, allTime, custom] } }
 *     responses:
 *       200: { description: Project with financials }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
projectsRouter.get(
  '/:id',
  validate({ params: projectIdParamSchema, query: dateRangeQueryShape.partial() }),
  controller.getProjectHandler,
);

/**
 * @openapi
 * /projects:
 *   post:
 *     tags: [Projects]
 *     summary: Register a project
 *     description: >
 *       Registering a project does not require importing its source code. The
 *       project keeps running on its own server, domain and repository.
 *     responses:
 *       201: { description: Project created }
 *       409: { description: A project with that code already exists }
 */
projectsRouter.post(
  '/',
  requireFinancialWrite,
  writeRateLimit,
  validate({ body: createProjectSchema }),
  controller.createProjectHandler,
);

/**
 * @openapi
 * /projects/{id}:
 *   patch:
 *     tags: [Projects]
 *     summary: Update a project
 *     responses:
 *       200: { description: Project updated }
 *       422: { description: Currency cannot change once transactions exist }
 */
projectsRouter.patch(
  '/:id',
  requireFinancialWrite,
  writeRateLimit,
  validate({ params: projectIdParamSchema, body: updateProjectSchema }),
  controller.updateProjectHandler,
);

/**
 * @openapi
 * /projects/{id}/archive:
 *   post:
 *     tags: [Projects]
 *     summary: Archive a project, keeping all financial history
 *     responses:
 *       200: { description: Project archived }
 */
projectsRouter.post(
  '/:id/archive',
  requireFinancialWrite,
  validate({ params: projectIdParamSchema }),
  controller.archiveProjectHandler,
);

/**
 * @openapi
 * /projects/{id}/restore:
 *   post:
 *     tags: [Projects]
 *     summary: Restore an archived project
 *     responses:
 *       200: { description: Project restored }
 */
projectsRouter.post(
  '/:id/restore',
  requireFinancialWrite,
  validate({ params: projectIdParamSchema }),
  controller.restoreProjectHandler,
);

/**
 * @openapi
 * /projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete a project that has no financial records
 *     description: Refused when any transaction, expense, subscription or invoice exists. Archive instead.
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Financial records exist }
 */
projectsRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: projectIdParamSchema }),
  controller.deleteProjectHandler,
);
