import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { prisma, type Db } from '../../config/prisma.js';
import { randomToken, sha256, uuid } from '../../utils/crypto.js';
import { unauthenticated } from '../../utils/errors.js';

/**
 * Token strategy
 * --------------
 * Access token   Short-lived (default 15 min) stateless JWT. Carries only the
 *                user id — roles are re-read from the database on every request
 *                so a revoked membership takes effect immediately.
 *
 * Refresh token  Long-lived OPAQUE random string. Only its SHA-256 is stored,
 *                so a database leak cannot be replayed as a login.
 *
 * Rotation       Every refresh issues a new token and revokes the old one.
 *                Tokens share a `familyId`. Presenting an already-revoked token
 *                means it was stolen and replayed, so the entire family is
 *                revoked at once and the session is killed.
 */

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  type: 'access';
}

export type ClientType = 'web' | 'mobile';

export function signAccessToken(userId: string): { token: string; expiresInSeconds: number } {
  const expiresInSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    subject: userId,
    jwtid: uuid(),
  };
  const token = jwt.sign({ type: 'access' }, env.ACCESS_TOKEN_SECRET, options);
  return { token, expiresInSeconds };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
    if (typeof decoded === 'string' || decoded.type !== 'access' || !decoded.sub) {
      throw unauthenticated('Malformed access token', 'TOKEN_INVALID');
    }
    return decoded as AccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw unauthenticated('Access token has expired', 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw unauthenticated('Access token is invalid', 'TOKEN_INVALID');
    }
    throw error;
  }
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  db: Db,
  params: { userId: string; familyId?: string; userAgent?: string; ipAddress?: string },
): Promise<IssuedRefreshToken> {
  const token = randomToken(48);
  const tokenHash = sha256(token);
  const familyId = params.familyId ?? uuid();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.refreshToken.create({
    data: {
      userId: params.userId,
      tokenHash,
      familyId,
      expiresAt,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
    },
  });

  return { token, tokenHash, familyId, expiresAt };
}

/**
 * Validates and rotates a refresh token.
 *
 * Throws on expiry, revocation or reuse. Reuse additionally revokes every token
 * in the family — the standard defence against a stolen refresh token.
 */
export async function rotateRefreshToken(params: {
  presentedToken: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
  const presentedHash = sha256(params.presentedToken);

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: presentedHash },
    include: { user: { select: { id: true, isActive: true } } },
  });

  if (!existing) {
    throw unauthenticated('Refresh token is invalid', 'TOKEN_INVALID');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw unauthenticated('Refresh token has expired', 'TOKEN_EXPIRED');
  }

  if (!existing.user.isActive) {
    throw unauthenticated('This account is disabled', 'FORBIDDEN');
  }

  /**
   * Atomically claim the token by revoking it. `updateMany` with
   * `revokedAt: null` in the WHERE clause is a compare-and-set: exactly one
   * caller can win, so two concurrent refreshes cannot both mint a token.
   *
   * NOTE: the revocation below must NOT run inside an interactive transaction
   * that then throws — the rollback would undo it and leave a stolen token
   * family alive. Each write here commits on its own, before we throw.
   */
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: existing.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (claimed.count === 0) {
    // The token was already rotated away, so this is a replay of a stolen
    // token. Kill every live token in the family and force a fresh sign-in.
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthenticated('Refresh token has been revoked — please sign in again', 'TOKEN_INVALID');
  }

  const next = await issueRefreshToken(prisma, {
    userId: existing.userId,
    familyId: existing.familyId,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { replacedByTokenHash: next.tokenHash },
  });

  return { userId: existing.userId, refresh: next };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Logs the user out of every device. */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Housekeeping: drop tokens that expired more than 30 days ago. */
export async function pruneExpiredTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return result.count;
}

export const REFRESH_COOKIE_NAME = 'cms_refresh_token';

export function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
  domain?: string;
} {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: `${env.API_PREFIX}/auth`,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}
