import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { unauthenticated } from '../utils/errors.js';
import { asyncHandler } from '../utils/http.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

/**
 * Verifies the bearer access token and loads the user.
 *
 * The user record is re-read on every request, so deactivating an account takes
 * effect immediately rather than when the access token happens to expire.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw unauthenticated('Missing bearer token');
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) throw unauthenticated('Missing bearer token');

  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, fullName: true, timezone: true, isActive: true },
  });

  if (!user) throw unauthenticated('Account no longer exists');
  if (!user.isActive) throw unauthenticated('This account is disabled');

  req.user = { id: user.id, email: user.email, fullName: user.fullName, timezone: user.timezone };
  next();
});

/** Reads the user if a valid token is present, but never rejects. */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) return next();
    try {
      const payload = verifyAccessToken(header.slice(7).trim());
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, fullName: true, timezone: true, isActive: true },
      });
      if (user?.isActive) {
        req.user = { id: user.id, email: user.email, fullName: user.fullName, timezone: user.timezone };
      }
    } catch {
      // Ignored by design.
    }
    next();
  },
);
