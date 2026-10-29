import type { Request, Response } from 'express';
import { env } from '../../config/env.js';
import { unauthenticated } from '../../utils/errors.js';
import { asyncHandler, clientIp, created, noContent, ok, userAgent } from '../../utils/http.js';
import { auditFromRequest } from '../../services/audit.service.js';
import { requireUser } from '../../middleware/company-scope.js';
import * as authService from './auth.service.js';
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  revokeAllUserTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokens.js';
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  LoginInput,
  RefreshInput,
  ResetPasswordInput,
  UpdateProfileInput,
} from './auth.validators.js';

/**
 * Token delivery differs by client:
 *   web     refresh token in an HttpOnly, SameSite cookie (not reachable from JS)
 *   mobile  refresh token in the JSON body, stored in Flutter Secure Storage
 * The access token always goes in the body; clients hold it in memory only.
 */
function sendSession(
  res: Response,
  result: authService.LoginResult,
  client: 'web' | 'mobile',
  statusCode: 200 | 201 = 200,
) {
  const payload: Record<string, unknown> = {
    user: result.user,
    memberships: result.memberships,
    accessToken: result.accessToken,
    accessTokenExpiresIn: result.accessTokenExpiresIn,
    tokenType: 'Bearer',
  };

  if (client === 'mobile') {
    payload.refreshToken = result.refreshToken;
    payload.refreshTokenExpiresAt = result.refreshTokenExpiresAt.toISOString();
  } else {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
  }

  return statusCode === 201 ? created(res, payload) : ok(res, payload);
}

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as LoginInput;

  try {
    const result = await authService.login({
      email: body.email,
      password: body.password,
      userAgent: userAgent(req),
      ipAddress: clientIp(req),
    });

    await auditFromRequest(req, {
      action: 'auth.login',
      entityType: 'User',
      entityId: result.user.id,
      summary: `${result.user.email} signed in from ${body.client}`,
      companyId: result.memberships[0]?.companyId ?? null,
    });

    // Set req.user so the audit above and any later middleware see the actor.
    req.user = {
      id: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      timezone: result.user.timezone,
    };

    return sendSession(res, result, body.client);
  } catch (error) {
    await auditFromRequest(req, {
      action: 'auth.login_failed',
      entityType: 'User',
      entityId: null,
      summary: `Failed sign-in attempt for ${body.email}`,
    });
    throw error;
  }
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RefreshInput;
  const presented = body.refreshToken ?? (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);

  if (!presented) throw unauthenticated('No refresh token supplied', 'TOKEN_INVALID');

  const { userId, refresh } = await rotateRefreshToken({
    presentedToken: presented,
    userAgent: userAgent(req),
    ipAddress: clientIp(req),
  });

  const { token: accessToken, expiresInSeconds } = signAccessToken(userId);

  const payload: Record<string, unknown> = {
    accessToken,
    accessTokenExpiresIn: expiresInSeconds,
    tokenType: 'Bearer',
  };

  if (body.client === 'mobile') {
    payload.refreshToken = refresh.token;
    payload.refreshTokenExpiresAt = refresh.expiresAt.toISOString();
  } else {
    res.cookie(REFRESH_COOKIE_NAME, refresh.token, refreshCookieOptions());
  }

  return ok(res, payload);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { refreshToken?: string; allDevices?: boolean };
  const presented = body.refreshToken ?? (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);

  if (body.allDevices && req.user) {
    await revokeAllUserTokens(req.user.id);
  } else if (presented) {
    await revokeRefreshToken(presented);
  }

  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined } as never);

  if (req.user) {
    await auditFromRequest(req, {
      action: 'auth.logout',
      entityType: 'User',
      entityId: req.user.id,
      summary: body.allDevices ? 'Signed out of all devices' : 'Signed out',
    });
  }

  return noContent(res);
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const profile = await authService.getProfile(user.id);
  return ok(res, profile);
});

export const updateProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const body = req.body as UpdateProfileInput;

  const before = await authService.getProfile(user.id);
  const updated = await authService.updateProfile(user.id, {
    ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
  });

  await auditFromRequest(req, {
    action: 'auth.password_change',
    entityType: 'User',
    entityId: user.id,
    summary: 'Profile updated',
    before: { fullName: before.fullName, timezone: before.timezone, locale: before.locale },
    after: updated,
  });

  return ok(res, updated);
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const body = req.body as ChangePasswordInput;

  await authService.changePassword({
    userId: user.id,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });

  await auditFromRequest(req, {
    action: 'auth.password_change',
    entityType: 'User',
    entityId: user.id,
    summary: 'Password changed; all sessions revoked',
  });

  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieOptions(), maxAge: undefined } as never);
  return ok(res, { message: 'Password updated. Please sign in again on all devices.' });
});

export const forgotPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body as { email: string };
  const token = await authService.createPasswordResetToken(email);

  await auditFromRequest(req, {
    action: 'auth.password_reset_requested',
    entityType: 'User',
    entityId: null,
    summary: `Password reset requested for ${email}`,
  });

  // The same response either way — this endpoint must not reveal which
  // addresses have accounts.
  const payload: Record<string, unknown> = {
    message: 'If an account exists for that address, a reset link has been sent.',
  };

  // Email delivery is not configured in this build. Rather than pretend a mail
  // was sent, the token is returned in non-production so the flow is testable.
  // See docs/deployment.md for wiring a real transactional email provider.
  if (env.NODE_ENV !== 'production' && token) {
    payload.devResetToken = token;
  }

  return ok(res, payload);
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResetPasswordInput;
  const userId = await authService.resetPassword(body);

  await auditFromRequest(req, {
    action: 'auth.password_reset_completed',
    entityType: 'User',
    entityId: userId,
    summary: 'Password reset completed; all sessions revoked',
  });

  return ok(res, { message: 'Password has been reset. You can now sign in.' });
});

export const acceptInviteHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as AcceptInviteInput;

  const result = await authService.acceptInvite({
    token: body.token,
    password: body.password,
    ...(body.fullName ? { fullName: body.fullName } : {}),
    userAgent: userAgent(req),
    ipAddress: clientIp(req),
  });

  req.user = {
    id: result.user.id,
    email: result.user.email,
    fullName: result.user.fullName,
    timezone: result.user.timezone,
  };

  await auditFromRequest(req, {
    action: 'member.invite',
    entityType: 'User',
    entityId: result.user.id,
    summary: `${result.user.email} accepted their invitation`,
    companyId: result.memberships[0]?.companyId ?? null,
  });

  return sendSession(res, result, 'web', 201);
});
