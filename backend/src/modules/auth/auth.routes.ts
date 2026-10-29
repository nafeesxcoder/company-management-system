import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from './auth.validators.js';

export const authRouter: Router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in and receive an access token
 *     description: >
 *       Web clients receive the refresh token as an HttpOnly cookie.
 *       Mobile clients pass `client: "mobile"` and receive it in the body.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               client: { type: string, enum: [web, mobile], default: web }
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid credentials }
 *       429: { description: Too many attempts }
 */
authRouter.post('/login', authRateLimit, validate({ body: loginSchema }), controller.loginHandler);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate the refresh token and get a new access token
 *     description: >
 *       Refresh tokens rotate on every use. Presenting an already-rotated token
 *       revokes the whole token family, on the assumption it was stolen.
 *     security: []
 *     responses:
 *       200: { description: New access token issued }
 *       401: { description: Refresh token missing, expired or revoked }
 */
authRouter.post('/refresh', authRateLimit, validate({ body: refreshSchema }), controller.refreshHandler);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke the current session, or every session
 *     responses:
 *       204: { description: Signed out }
 */
authRouter.post(
  '/logout',
  optionalAuthenticate,
  validate({ body: logoutSchema }),
  controller.logoutHandler,
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current user with company memberships and roles
 *     responses:
 *       200: { description: Profile }
 *       401: { description: Not authenticated }
 */
authRouter.get('/me', authenticate, controller.meHandler);

/**
 * @openapi
 * /auth/me:
 *   patch:
 *     tags: [Auth]
 *     summary: Update the signed-in user's own profile
 *     responses:
 *       200: { description: Updated profile }
 */
authRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateProfileSchema }),
  controller.updateProfileHandler,
);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password (revokes all sessions)
 *     responses:
 *       200: { description: Password changed }
 *       401: { description: Current password incorrect }
 */
authRouter.post(
  '/change-password',
  authenticate,
  authRateLimit,
  validate({ body: changePasswordSchema }),
  controller.changePasswordHandler,
);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset link
 *     description: Always returns 200 so the endpoint cannot enumerate accounts.
 *     security: []
 *     responses:
 *       200: { description: Request accepted }
 */
authRouter.post(
  '/forgot-password',
  authRateLimit,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPasswordHandler,
);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Complete a password reset with a one-time token
 *     security: []
 *     responses:
 *       200: { description: Password reset }
 *       422: { description: Token invalid or expired }
 */
authRouter.post(
  '/reset-password',
  authRateLimit,
  validate({ body: resetPasswordSchema }),
  controller.resetPasswordHandler,
);

/**
 * @openapi
 * /auth/accept-invite:
 *   post:
 *     tags: [Auth]
 *     summary: Accept a company invitation and set a password
 *     security: []
 *     responses:
 *       201: { description: Invitation accepted, session created }
 *       422: { description: Invitation invalid or expired }
 */
authRouter.post(
  '/accept-invite',
  authRateLimit,
  validate({ body: acceptInviteSchema }),
  controller.acceptInviteHandler,
);
