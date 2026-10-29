import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env, isTest } from '../config/env.js';

/**
 * Rate limiting.
 *
 * The default in-memory store is per-process. Behind more than one instance,
 * swap in a shared store (Redis) — see docs/deployment.md. Auth and webhook
 * endpoints get their own stricter buckets.
 */

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Disabled under test so suites don't trip over their own request volume.
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests — please slow down and try again shortly',
      },
    });
  },
};

export const globalRateLimit = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
});

/**
 * Login / refresh / password reset.
 * Keyed on IP + submitted email so one attacker cannot lock out a real user
 * by hammering their address from elsewhere.
 */
export const authRateLimit = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'anonymous';
    return `${req.ip ?? 'unknown'}:${email}`;
  },
  skipSuccessfulRequests: true,
});

/** Writes to financial records. */
export const writeRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 60,
});

/**
 * Webhooks. Generous, because providers legitimately burst, but still bounded
 * so an unsigned flood cannot exhaust the process.
 */
export const webhookRateLimit = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 600,
});
