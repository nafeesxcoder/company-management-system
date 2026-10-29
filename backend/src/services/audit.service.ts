import type { Request } from 'express';
import type { Db } from '../config/prisma.js';
import { prisma } from '../config/prisma.js';
import { logger } from '../utils/logger.js';
import { clientIp, userAgent } from '../utils/http.js';

/**
 * Audit trail.
 *
 * Every financial change records who did it, what changed and when. Writing an
 * audit row must never break the business operation, so failures are logged and
 * swallowed — except inside a transaction, where the caller passes `db` and the
 * audit row commits atomically with the change it describes.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.password_change'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_completed'
  | 'auth.login_failed'
  | 'company.update'
  | 'member.invite'
  | 'member.role_change'
  | 'member.suspend'
  | 'member.remove'
  | 'project.create'
  | 'project.update'
  | 'project.archive'
  | 'project.delete'
  | 'transaction.create'
  | 'transaction.update'
  | 'transaction.delete'
  | 'transaction.reassign_project'
  | 'refund.create'
  | 'refund.update'
  | 'expense.create'
  | 'expense.update'
  | 'expense.delete'
  | 'expense_category.create'
  | 'expense_category.update'
  | 'subscription.update'
  | 'provider.create'
  | 'provider.update'
  | 'provider.delete'
  | 'provider.secret_rotated'
  | 'provider.mapping_create'
  | 'provider.mapping_delete'
  | 'profit_share.update'
  | 'payout.create'
  | 'payout.update'
  | 'payout.delete'
  | 'exchange_rate.create'
  | 'webhook.received'
  | 'webhook.processed'
  | 'webhook.failed'
  | 'webhook.signature_rejected';

export interface AuditInput {
  companyId?: string | null;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Fields that must never be written into an audit payload. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'apiKey',
  'apiKeyCiphertext',
  'webhookSecret',
  'webhookSecretCiphertext',
  'secretKey',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'resetTokenHash',
]);

function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => scrub(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // Prisma Decimal and similar wrappers serialise as strings.
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        companyId: input.companyId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary?.slice(0, 500) ?? null,
        beforeData: input.before === undefined ? undefined : (scrub(input.before) as never),
        afterData: input.after === undefined ? undefined : (scrub(input.after) as never),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'Failed to write audit log');
    if (db !== prisma) throw error; // inside a transaction, fail loudly
  }
}

/** Convenience wrapper that pulls actor, company, IP and UA off the request. */
export async function auditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'actorId' | 'companyId' | 'ipAddress' | 'userAgent'> &
    Partial<Pick<AuditInput, 'companyId'>>,
  db: Db = prisma,
): Promise<void> {
  await recordAudit(
    {
      ...input,
      actorId: req.user?.id ?? null,
      companyId: input.companyId ?? req.company?.companyId ?? null,
      ipAddress: clientIp(req) ?? null,
      userAgent: userAgent(req) ?? null,
    },
    db,
  );
}
