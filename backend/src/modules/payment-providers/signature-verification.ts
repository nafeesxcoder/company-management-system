import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { hmacSha256, timingSafeEqual } from '../../utils/crypto.js';

/**
 * Webhook signature verification.
 *
 * A webhook endpoint is an unauthenticated, internet-facing route that CREATES
 * REVENUE RECORDS. Without signature verification, anyone who learns the URL
 * can fabricate income. Every verifier here therefore:
 *
 *   - compares in constant time (never `===`, which leaks the match position
 *     through timing);
 *   - checks a timestamp where the provider supplies one, so a captured-and-
 *     replayed request stops working after WEBHOOK_TOLERANCE_SECONDS;
 *   - works on the RAW request bytes, because re-serialising JSON changes
 *     whitespace and key order and invalidates the signature.
 */

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Stripe: `Stripe-Signature: t=<unix>,v1=<hex hmac>`
 * Signed payload is `${t}.${rawBody}` with HMAC-SHA256 and the endpoint secret.
 */
export function verifyStripeSignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): VerificationResult {
  const { rawBody, signatureHeader, secret } = params;
  if (!signatureHeader) return { valid: false, reason: 'Missing Stripe-Signature header' };
  if (!secret) return { valid: false, reason: 'No webhook secret configured for this account' };

  const parts = signatureHeader.split(',').reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split('=', 2);
    if (!key || !value) return acc;
    (acc[key.trim()] ??= []).push(value.trim());
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];

  if (!timestamp) return { valid: false, reason: 'Signature header has no timestamp' };
  if (signatures.length === 0) return { valid: false, reason: 'Signature header has no v1 signature' };

  const tolerance = params.toleranceSeconds ?? env.WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) {
    return { valid: false, reason: `Timestamp outside the ${tolerance}s tolerance (possible replay)` };
  }

  const expected = hmacSha256(secret, `${timestamp}.${rawBody.toString('utf8')}`);
  // Stripe may send several signatures during a secret rotation.
  const matched = signatures.some((candidate) => timingSafeEqual(expected, candidate));

  return matched ? { valid: true } : { valid: false, reason: 'Signature does not match' };
}

/**
 * Razorpay: `X-Razorpay-Signature` is HMAC-SHA256 of the raw body with the
 * webhook secret. No timestamp is included, so replay protection comes from
 * event-id idempotency instead.
 */
export function verifyRazorpaySignature(params: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
}): VerificationResult {
  const { rawBody, signatureHeader, secret } = params;
  if (!signatureHeader) return { valid: false, reason: 'Missing X-Razorpay-Signature header' };
  if (!secret) return { valid: false, reason: 'No webhook secret configured for this account' };

  const expected = hmacSha256(secret, rawBody);
  return timingSafeEqual(expected, signatureHeader.trim())
    ? { valid: true }
    : { valid: false, reason: 'Signature does not match' };
}

/**
 * Google Play Billing arrives via Pub/Sub push.
 *
 * Production verification means validating the Google-signed OIDC JWT in the
 * Authorization header against Google's public keys and checking its audience.
 * That requires a network call to fetch and cache the JWKS, which this build
 * does not perform — so the shared verification token is treated as a
 * NECESSARY BUT NOT SUFFICIENT check, and `requiresAdditionalSetup` is
 * returned so the caller cannot mistake this for full verification.
 *
 * See docs/payment-integrations.md before enabling Google Play in production.
 */
export function verifyGooglePlayPush(params: {
  verificationToken: string | undefined;
  expectedToken: string;
}): VerificationResult & { requiresAdditionalSetup: true } {
  const { verificationToken, expectedToken } = params;

  if (!expectedToken) {
    return {
      valid: false,
      reason: 'No Google Play verification token configured',
      requiresAdditionalSetup: true,
    };
  }
  if (!verificationToken) {
    return { valid: false, reason: 'Missing verification token', requiresAdditionalSetup: true };
  }

  return {
    valid: timingSafeEqual(expectedToken, verificationToken),
    reason: timingSafeEqual(expectedToken, verificationToken) ? undefined : 'Verification token mismatch',
    requiresAdditionalSetup: true,
  };
}

/**
 * Generic HMAC-SHA256 verifier for a custom provider or one of the user's own
 * app backends reporting its payments to this system.
 *
 * The signed payload is `${timestamp}.${rawBody}`, matching Stripe's scheme, so
 * replay protection works the same way.
 */
export function verifyGenericHmac(params: {
  rawBody: Buffer;
  signature: string | undefined;
  timestamp: string | undefined;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): VerificationResult {
  const { rawBody, signature, timestamp, secret } = params;
  if (!signature) return { valid: false, reason: 'Missing signature header' };
  if (!timestamp) return { valid: false, reason: 'Missing timestamp header' };
  if (!secret) return { valid: false, reason: 'No webhook secret configured for this account' };

  const tolerance = params.toleranceSeconds ?? env.WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((params.now ?? Date.now()) / 1000);
  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > tolerance) {
    return { valid: false, reason: `Timestamp outside the ${tolerance}s tolerance (possible replay)` };
  }

  const expected = hmacSha256(secret, `${timestamp}.${rawBody.toString('utf8')}`);
  return timingSafeEqual(expected, signature.trim())
    ? { valid: true }
    : { valid: false, reason: 'Signature does not match' };
}

/** Builds a valid signature — used by tests and by the documented test harness. */
export function signPayloadForTesting(secret: string, rawBody: string, timestamp: number): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}
