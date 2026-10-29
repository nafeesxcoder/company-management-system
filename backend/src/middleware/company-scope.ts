import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import type { MembershipRole } from '../generated/prisma/enums.js';
import { forbidden, notFound, unauthenticated } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';

/**
 * Company data isolation — the single most important authorisation rule here.
 *
 * Every financial route runs behind this. It resolves the company from an
 * ACTIVE membership of the authenticated user, and from then on queries filter
 * on `req.company.companyId`. A company id in the URL or body is never trusted
 * on its own: without a matching membership the request 404s, so one partner
 * cannot probe another company's ids.
 */

export const companyScope = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthenticated();

  // Explicit selection wins; otherwise fall back to the user's only membership.
  const requested =
    (req.params.companyId as string | undefined) ??
    (req.get('x-company-id') ?? undefined) ??
    (typeof req.query.companyId === 'string' ? req.query.companyId : undefined);

  const memberships = await prisma.companyMembership.findMany({
    where: { userId: req.user.id, status: 'ACTIVE' },
    select: {
      companyId: true,
      role: true,
      company: { select: { baseCurrency: true, timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) {
    throw forbidden('Your account is not an active member of any company');
  }

  const membership = requested
    ? memberships.find((m) => m.companyId === requested)
    : memberships[0];

  if (!membership) {
    // Deliberately 404, not 403: do not confirm that the id exists.
    throw notFound('Company');
  }

  req.company = {
    companyId: membership.companyId,
    role: membership.role,
    baseCurrency: membership.company.baseCurrency,
    timezone: membership.company.timezone,
  };

  next();
});

/** Role hierarchy. A higher rank satisfies every requirement at or below it. */
const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  PARTNER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function requireRole(...allowed: MembershipRole[]) {
  const minimumRank = Math.min(...allowed.map((r) => ROLE_RANK[r]));
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.company) {
      next(forbidden('Company context is required for this route'));
      return;
    }
    if (ROLE_RANK[req.company.role] < minimumRank) {
      next(
        forbidden(
          `This action requires the ${allowed.join(' or ')} role; your role is ${req.company.role}`,
        ),
      );
      return;
    }
    next();
  };
}

/** Write access to financial records: PARTNER and above. VIEWER is read-only. */
export const requireFinancialWrite = requireRole('PARTNER');

/** Company administration: integrations, roles, profit-share configuration. */
export const requireAdmin = requireRole('ADMIN');

/** Reserved for ownership transfer and company deletion. */
export const requireOwner = requireRole('OWNER');

/** Narrowed accessors so handlers don't repeat the non-null assertions. */
export function requireCompanyContext(req: Request) {
  if (!req.company) throw forbidden('Company context is required for this route');
  return req.company;
}

export function requireUser(req: Request) {
  if (!req.user) throw unauthenticated();
  return req.user;
}
