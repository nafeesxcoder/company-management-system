import type { Request, Response } from 'express';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { requireCompanyContext, requireUser } from '../../middleware/company-scope.js';
import { auditFromRequest } from '../../services/audit.service.js';
import { resolveDateRange, type DateRangeQuery } from '../../utils/dates.js';
import * as service from './projects.service.js';
import type { CreateProjectInput, ListProjectsQuery, UpdateProjectInput } from './projects.validators.js';

export const listProjectsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const query = req.query as unknown as ListProjectsQuery;

  const { items, totalItems } = await service.listProjects(companyId, query);
  return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
});

export const getProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, baseCurrency, timezone } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const query = req.query as unknown as Partial<DateRangeQuery>;
  const range = query.preset ? resolveDateRange(query, timezone) : undefined;

  const result = await service.getProjectWithFinancials(companyId, id, baseCurrency, range);
  return ok(res, result, range ? { range: { from: range.from, to: range.to, label: range.label } } : undefined);
});

export const createProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const user = requireUser(req);
  const input = req.body as CreateProjectInput;

  const project = await service.createProject({ companyId, createdById: user.id, input });

  await auditFromRequest(req, {
    action: 'project.create',
    entityType: 'Project',
    entityId: project.id,
    summary: `Created project "${project.name}" (${project.code})`,
    after: project,
  });

  return created(res, project);
});

export const updateProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };
  const input = req.body as UpdateProjectInput;

  const { before, after } = await service.updateProject({ companyId, projectId: id, input });

  await auditFromRequest(req, {
    action: 'project.update',
    entityType: 'Project',
    entityId: id,
    summary: `Updated project "${after.name}" (${after.code})`,
    before,
    after,
  });

  return ok(res, after);
});

export const archiveProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const project = await service.archiveProject(companyId, id);

  await auditFromRequest(req, {
    action: 'project.archive',
    entityType: 'Project',
    entityId: id,
    summary: `Archived project "${project.name}" (${project.code})`,
    after: { archivedAt: project.archivedAt, status: project.status },
  });

  return ok(res, project);
});

export const restoreProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const project = await service.restoreProject(companyId, id);

  await auditFromRequest(req, {
    action: 'project.update',
    entityType: 'Project',
    entityId: id,
    summary: `Restored project "${project.name}" (${project.code}) from the archive`,
    after: { archivedAt: null, status: project.status },
  });

  return ok(res, project);
});

export const deleteProjectHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = requireCompanyContext(req);
  const { id } = req.params as { id: string };

  const project = await service.deleteProject(companyId, id);

  await auditFromRequest(req, {
    action: 'project.delete',
    entityType: 'Project',
    entityId: id,
    summary: `Deleted project "${project.name}" (${project.code})`,
    before: project,
  });

  return noContent(res);
});
