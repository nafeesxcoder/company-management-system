import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireCompanyContext, requireOwner, requireUser } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { auditFromRequest } from '../../services/audit.service.js';
import { createInvitedUser } from '../auth/auth.service.js';
import { env } from '../../config/env.js';
import { emailSchema } from '../auth/auth.validators.js';

/**
 * Company settings, membership and the audit log.
 *
 * Membership rules exist to keep a two-partner company genuinely private:
 *   - no public registration; members arrive only by invitation;
 *   - a company can never be left with no Owner;
 *   - nobody can change or remove their own role.
 */
export const companiesRouter: Router = Router();
export const membersRouter: Router = Router();
export const auditLogsRouter: Router = Router();

companiesRouter.use(authenticate, companyScope);
membersRouter.use(authenticate, companyScope);
auditLogsRouter.use(authenticate, companyScope);

const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    legalName: z.string().trim().max(200).nullish(),
    timezone: z.string().trim().min(2).max(64).optional(),
    fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
    logoUrl: z.string().url().max(512).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

const inviteSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(['ADMIN', 'PARTNER', 'VIEWER']).default('PARTNER'),
});

const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'PARTNER', 'VIEWER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

/**
 * @openapi
 * /companies/current:
 *   get:
 *     tags: [Companies]
 *     summary: The current company's settings
 *     responses:
 *       200: { description: Company }
 */
companiesRouter.get(
  '/current',
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, role } = requireCompanyContext(req);

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        legalName: true,
        baseCurrency: true,
        timezone: true,
        fiscalYearStartMonth: true,
        logoUrl: true,
        createdAt: true,
        _count: { select: { projects: true, memberships: true } },
      },
    });
    if (!company) throw notFound('Company');

    return ok(res, { ...company, yourRole: role });
  }),
);

/**
 * @openapi
 * /companies/current:
 *   patch:
 *     tags: [Companies]
 *     summary: Update company settings
 *     description: >
 *       The base currency is deliberately NOT editable. Changing it after
 *       financial records exist would silently reinterpret every historical
 *       figure.
 *     responses:
 *       200: { description: Updated }
 */
companiesRouter.patch(
  '/current',
  requireAdmin,
  validate({ body: updateCompanySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const input = req.body as z.infer<typeof updateCompanySchema>;

    const before = await prisma.company.findUnique({ where: { id: companyId } });
    if (!before) throw notFound('Company');

    const after = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.fiscalYearStartMonth !== undefined
          ? { fiscalYearStartMonth: input.fiscalYearStartMonth }
          : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
      },
    });

    await auditFromRequest(req, {
      action: 'company.update',
      entityType: 'Company',
      entityId: companyId,
      summary: 'Updated company settings',
      before,
      after,
    });

    return ok(res, after);
  }),
);

/**
 * @openapi
 * /members:
 *   get:
 *     tags: [Members]
 *     summary: List company members
 *     responses:
 *       200: { description: Members with roles and status }
 */
membersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);

    const members = await prisma.companyMembership.findMany({
      where: { companyId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        role: true,
        status: true,
        invitedAt: true,
        joinedAt: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        invitedBy: { select: { id: true, fullName: true } },
      },
    });

    return ok(res, members);
  }),
);

/**
 * @openapi
 * /members/invite:
 *   post:
 *     tags: [Members]
 *     summary: Invite a partner to the company
 *     description: >
 *       Creates an inactive account plus a single-use invitation token. There is
 *       no public registration — this is the only way to join a company.
 *       Email delivery is not configured in this build, so the invite link is
 *       returned for the inviter to pass on; see docs/deployment.md.
 *     responses:
 *       201: { description: Invitation created }
 *       409: { description: A user with that email already exists }
 */
membersRouter.post(
  '/invite',
  requireAdmin,
  validate({ body: inviteSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const actor = requireUser(req);
    const input = req.body as z.infer<typeof inviteSchema>;

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });

      if (existingUser) {
        const alreadyMember = await tx.companyMembership.findUnique({
          where: { companyId_userId: { companyId, userId: existingUser.id } },
          select: { id: true },
        });
        if (alreadyMember) throw conflict('That person is already a member of this company');

        // The account exists (another company); just add the membership.
        const membership = await tx.companyMembership.create({
          data: {
            companyId,
            userId: existingUser.id,
            role: input.role,
            status: 'ACTIVE',
            invitedById: actor.id,
            invitedAt: new Date(),
            joinedAt: new Date(),
          },
          select: { id: true },
        });
        return { membershipId: membership.id, token: null, userId: existingUser.id };
      }

      const invited = await createInvitedUser(tx, {
        email: input.email,
        fullName: input.fullName,
      });

      const membership = await tx.companyMembership.create({
        data: {
          companyId,
          userId: invited.userId,
          role: input.role,
          status: 'INVITED',
          invitedById: actor.id,
          invitedAt: new Date(),
        },
        select: { id: true },
      });

      return { membershipId: membership.id, token: invited.token, userId: invited.userId };
    });

    await auditFromRequest(req, {
      action: 'member.invite',
      entityType: 'CompanyMembership',
      entityId: result.membershipId,
      summary: `Invited ${input.email} as ${input.role}`,
      after: { email: input.email, role: input.role },
    });

    return created(res, {
      membershipId: result.membershipId,
      userId: result.userId,
      email: input.email,
      role: input.role,
      status: result.token ? 'INVITED' : 'ACTIVE',
      // No mail transport is wired up, so the link is handed back rather than
      // pretending an email was sent.
      ...(result.token
        ? {
            inviteToken: result.token,
            inviteUrl: `${env.WEB_ORIGIN[0] ?? ''}/accept-invite?token=${result.token}`,
            deliveryNote:
              'Email delivery is not configured. Send this link to the invitee over a channel you trust; it expires in 72 hours.',
          }
        : { note: 'That account already existed and has been added to this company directly.' }),
    });
  }),
);

/**
 * @openapi
 * /members/{id}:
 *   patch:
 *     tags: [Members]
 *     summary: Change a member's role or suspend them
 *     description: >
 *       A company can never be left without an Owner, and nobody may change
 *       their own role — that would let an Admin quietly promote themselves.
 *     responses:
 *       200: { description: Updated }
 *       422: { description: Would remove the last Owner, or targets yourself }
 */
membersRouter.patch(
  '/:id',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }), body: updateMemberSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, role: actorRole } = requireCompanyContext(req);
    const actor = requireUser(req);
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof updateMemberSchema>;

    const membership = await prisma.companyMembership.findFirst({
      where: { id, companyId },
      select: { id: true, userId: true, role: true, status: true, user: { select: { email: true } } },
    });
    if (!membership) throw notFound('Member');

    if (membership.userId === actor.id) {
      throw unprocessable('You cannot change your own role or status');
    }

    // Only an Owner may create or remove another Owner.
    if ((input.role === 'OWNER' || membership.role === 'OWNER') && actorRole !== 'OWNER') {
      throw forbidden('Only an Owner can change Owner roles');
    }

    if (membership.role === 'OWNER' && (input.role !== undefined || input.status === 'SUSPENDED')) {
      const otherOwners = await prisma.companyMembership.count({
        where: { companyId, role: 'OWNER', status: 'ACTIVE', id: { not: id } },
      });
      if (otherOwners === 0) {
        throw unprocessable(
          'This is the only Owner. Promote another member to Owner before changing this one.',
        );
      }
    }

    const updated = await prisma.companyMembership.update({
      where: { id },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { id: true, email: true, fullName: true } },
      },
    });

    await auditFromRequest(req, {
      action: input.status === 'SUSPENDED' ? 'member.suspend' : 'member.role_change',
      entityType: 'CompanyMembership',
      entityId: id,
      summary: `Changed ${membership.user.email}: role ${membership.role} -> ${updated.role}, status ${membership.status} -> ${updated.status}`,
      before: { role: membership.role, status: membership.status },
      after: { role: updated.role, status: updated.status },
    });

    return ok(res, updated);
  }),
);

/**
 * @openapi
 * /members/{id}:
 *   delete:
 *     tags: [Members]
 *     summary: Remove a member from the company
 *     description: >
 *       The user account and everything they recorded are preserved — only the
 *       membership is removed, so financial history keeps its authorship.
 *     responses:
 *       204: { description: Removed }
 */
membersRouter.delete(
  '/:id',
  requireOwner,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const actor = requireUser(req);
    const { id } = req.params as { id: string };

    const membership = await prisma.companyMembership.findFirst({
      where: { id, companyId },
      select: { id: true, userId: true, role: true, user: { select: { email: true } } },
    });
    if (!membership) throw notFound('Member');

    if (membership.userId === actor.id) throw unprocessable('You cannot remove yourself');

    if (membership.role === 'OWNER') {
      const otherOwners = await prisma.companyMembership.count({
        where: { companyId, role: 'OWNER', status: 'ACTIVE', id: { not: id } },
      });
      if (otherOwners === 0) throw unprocessable('Cannot remove the only Owner');
    }

    await prisma.$transaction(async (tx) => {
      await tx.companyMembership.delete({ where: { id } });
      // Removing access must also end any live session for that user.
      await tx.refreshToken.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await auditFromRequest(req, {
      action: 'member.remove',
      entityType: 'CompanyMembership',
      entityId: id,
      summary: `Removed ${membership.user.email} from the company and revoked their sessions`,
      before: membership,
    });

    return noContent(res);
  }),
);

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     tags: [Audit Logs]
 *     summary: Who changed what, and when
 *     parameters:
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: entityType, schema: { type: string } }
 *       - { in: query, name: actorId, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Paginated audit log }
 */
auditLogsRouter.get(
  '/',
  requireAdmin,
  validate({
    query: paginationQuerySchema.extend({
      action: z.string().max(80).optional(),
      entityType: z.string().max(60).optional(),
      entityId: z.string().max(64).optional(),
      actorId: z.string().uuid().optional(),
      from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
      to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const query = req.query as unknown as {
      page: number;
      pageSize: number;
      action?: string;
      entityType?: string;
      entityId?: string;
      actorId?: string;
      from?: string;
      to?: string;
    };

    const where = {
      companyId,
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          summary: true,
          beforeData: true,
          afterData: true,
          ipAddress: true,
          createdAt: true,
          actor: { select: { id: true, fullName: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
  }),
);
