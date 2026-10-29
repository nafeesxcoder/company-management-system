import argon2 from 'argon2';
import { prisma, type Db } from '../../config/prisma.js';
import { randomToken, sha256 } from '../../utils/crypto.js';
import { conflict, invalidCredentials, notFound, unauthenticated, unprocessable } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { issueRefreshToken, revokeAllUserTokens, signAccessToken } from './tokens.js';

/**
 * Authentication business logic.
 *
 * There is deliberately NO public sign-up that joins a company. Accounts are
 * created by an Owner/Admin invitation, or by the one-time bootstrap script
 * that creates the first Owner.
 */

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP minimum for argon2id
  timeCost: 2,
  parallelism: 1,
};

/** A dummy hash, verified against on unknown emails so response time does not
 *  reveal whether an account exists. */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash('not-a-real-password-placeholder', ARGON2_OPTIONS);
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
}

export interface MembershipSummary {
  companyId: string;
  companyName: string;
  role: string;
  baseCurrency: string;
  timezone: string;
}

export interface LoginResult {
  user: SessionUser;
  memberships: MembershipSummary[];
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function login(params: {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: params.email } });

  if (!user) {
    await argon2.verify(await dummyHash(), params.password).catch(() => false);
    throw invalidCredentials();
  }

  const valid = await verifyPassword(user.passwordHash, params.password);
  if (!valid) throw invalidCredentials();
  if (!user.isActive) throw unauthenticated('This account is disabled');

  const memberships = await prisma.companyMembership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    select: {
      companyId: true,
      role: true,
      company: { select: { name: true, baseCurrency: true, timezone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (memberships.length === 0) {
    throw unauthenticated('Your account is not an active member of any company');
  }

  const { token: accessToken, expiresInSeconds } = signAccessToken(user.id);
  const refresh = await issueRefreshToken(prisma, {
    userId: user.id,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return {
    user: toSessionUser(user),
    memberships: memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      role: m.role,
      baseCurrency: m.company.baseCurrency,
      timezone: m.company.timezone,
    })),
    accessToken,
    accessTokenExpiresIn: expiresInSeconds,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

export function toSessionUser(user: {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    timezone: user.timezone,
    locale: user.locale,
  };
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      avatarUrl: true,
      timezone: true,
      locale: true,
      lastLoginAt: true,
      createdAt: true,
      memberships: {
        where: { status: 'ACTIVE' },
        select: {
          companyId: true,
          role: true,
          joinedAt: true,
          company: { select: { id: true, name: true, baseCurrency: true, timezone: true, logoUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!user) throw notFound('User');
  return user;
}

export async function updateProfile(
  userId: string,
  data: { fullName?: string; timezone?: string; locale?: string; avatarUrl?: string | null },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      fullName: true,
      avatarUrl: true,
      timezone: true,
      locale: true,
    },
  });
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw notFound('User');

  const valid = await verifyPassword(user.passwordHash, params.currentPassword);
  if (!valid) throw unauthenticated('Current password is incorrect', 'INVALID_CREDENTIALS');

  const passwordHash = await hashPassword(params.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // A password change invalidates every existing session.
  await revokeAllUserTokens(user.id);
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Creates a reset token. Always resolves, whether or not the email exists, so
 * the endpoint cannot be used to enumerate accounts.
 */
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  if (!user || !user.isActive) {
    logger.info({ email }, 'Password reset requested for unknown or disabled account');
    return null;
  }

  const token = randomToken(32);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resetTokenHash: sha256(token),
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  return token;
}

export async function resetPassword(params: { token: string; newPassword: string }): Promise<string> {
  const tokenHash = sha256(params.token);
  const user = await prisma.user.findFirst({
    where: { resetTokenHash: tokenHash, resetTokenExpiresAt: { gt: new Date() } },
    select: { id: true, isActive: true },
  });

  if (!user) throw unprocessable('This reset link is invalid or has expired');
  if (!user.isActive) throw unauthenticated('This account is disabled');

  const passwordHash = await hashPassword(params.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetTokenHash: null, resetTokenExpiresAt: null },
  });
  await revokeAllUserTokens(user.id);
  return user.id;
}

/**
 * Invitation acceptance. Reuses the reset-token columns: an invited user is
 * created with an unusable password hash plus a one-time token.
 */
export async function acceptInvite(params: {
  token: string;
  password: string;
  fullName?: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult> {
  const tokenHash = sha256(params.token);

  const invited = await prisma.user.findFirst({
    where: { resetTokenHash: tokenHash, resetTokenExpiresAt: { gt: new Date() } },
    select: { id: true, email: true, isActive: true, memberships: { select: { id: true, status: true } } },
  });

  if (!invited) throw unprocessable('This invitation is invalid or has expired');

  const passwordHash = await hashPassword(params.password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: invited.id },
      data: {
        passwordHash,
        isActive: true,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        ...(params.fullName ? { fullName: params.fullName } : {}),
      },
    });
    await tx.companyMembership.updateMany({
      where: { userId: invited.id, status: 'INVITED' },
      data: { status: 'ACTIVE', joinedAt: new Date() },
    });
  });

  return login({
    email: invited.email,
    password: params.password,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });
}

/** Creates an invited (not yet activated) user and returns the one-time token. */
export async function createInvitedUser(
  db: Db,
  params: { email: string; fullName: string; ttlHours?: number },
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const existing = await db.user.findUnique({ where: { email: params.email }, select: { id: true } });
  if (existing) throw conflict('A user with this email address already exists');

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (params.ttlHours ?? 72) * 60 * 60 * 1000);

  // An unusable placeholder hash: it is a valid argon2 encoding that no password
  // produces, so the account cannot be logged into before the invite is accepted.
  const placeholder = await hashPassword(randomToken(32));

  const user = await db.user.create({
    data: {
      email: params.email,
      fullName: params.fullName,
      passwordHash: placeholder,
      isActive: false,
      resetTokenHash: sha256(token),
      resetTokenExpiresAt: expiresAt,
    },
    select: { id: true },
  });

  return { userId: user.id, token, expiresAt };
}
