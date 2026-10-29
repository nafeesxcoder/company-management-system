import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { decryptSecret } from '../../utils/crypto.js';
import { asyncHandler } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';
import { notFound } from '../../utils/errors.js';
import { recordAudit } from '../../services/audit.service.js';
import { webhookRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import {
  normalizeGenericEvent,
  normalizeGooglePlayEvent,
  normalizeRazorpayEvent,
  normalizeStripeEvent,
} from './normalizers.js';
import {
  verifyGenericHmac,
  verifyGooglePlayPush,
  verifyRazorpaySignature,
  verifyStripeSignature,
} from './signature-verification.js';
import { processPaymentEvent, recordWebhookEvent } from './ingestion.service.js';

/**
 * Provider webhook endpoints.
 *
 * These are the only unauthenticated routes that create financial records, so
 * the rules are strict:
 *
 *   - The URL carries the provider ACCOUNT id, so each company's endpoint has
 *     its own secret. One company's leaked secret cannot forge another's income.
 *   - The signature is verified against the RAW bytes before anything is
 *     parsed as meaningful. A bad signature is logged and rejected; nothing is
 *     written to the financial tables.
 *   - A 200 is returned for anything we have durably recorded, including
 *     duplicates, so providers stop retrying. A 4xx/5xx is reserved for cases
 *     where we genuinely want the provider to try again.
 */
export const webhooksRouter: Router = Router();

const accountParamSchema = z.object({ accountId: z.string().uuid('Invalid provider account id') });

async function loadAccount(accountId: string) {
  const account = await prisma.paymentProviderAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      companyId: true,
      provider: true,
      isActive: true,
      webhookSecretCiphertext: true,
    },
  });

  if (!account) throw notFound('Payment provider account');
  return account;
}

function secretFor(account: { webhookSecretCiphertext: string | null }, fallback?: string): string {
  if (account.webhookSecretCiphertext) {
    try {
      return decryptSecret(account.webhookSecretCiphertext);
    } catch (error) {
      logger.error({ err: error }, 'Could not decrypt a stored webhook secret');
      return '';
    }
  }
  return fallback ?? '';
}

/** Records the rejection so a misconfiguration is visible, then 400s. */
async function rejectBadSignature(params: {
  res: Response;
  companyId: string;
  provider: 'STRIPE' | 'RAZORPAY' | 'GOOGLE_PLAY' | 'OTHER';
  accountId: string;
  reason: string;
}) {
  const { res, companyId, provider, accountId, reason } = params;

  logger.warn({ provider, accountId, reason }, 'Rejected a webhook with an invalid signature');

  await recordAudit({
    companyId,
    actorId: null,
    action: 'webhook.signature_rejected',
    entityType: 'PaymentProviderAccount',
    entityId: accountId,
    summary: `Rejected a ${provider} webhook: ${reason}`,
  });

  return res.status(400).json({
    error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature verification failed' },
  });
}

/**
 * @openapi
 * /webhooks/stripe/{accountId}:
 *   post:
 *     tags: [Webhooks]
 *     summary: Stripe webhook endpoint
 *     description: >
 *       Verifies the `Stripe-Signature` header against the raw body using the
 *       endpoint secret stored (encrypted) for this provider account, including
 *       the timestamp tolerance that defeats replays. Duplicate events are
 *       no-ops. Payments that cannot be mapped to a project are recorded and
 *       flagged for review rather than attributed to a guess.
 *     security: []
 *     parameters:
 *       - { in: path, name: accountId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Event received (processed, duplicate or ignored) }
 *       400: { description: Signature verification failed }
 */
webhooksRouter.post(
  '/stripe/:accountId',
  webhookRateLimit,
  validate({ params: accountParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.params as { accountId: string };
    const account = await loadAccount(accountId);
    const rawBody = req.rawBody ?? Buffer.from('');

    const verification = verifyStripeSignature({
      rawBody,
      signatureHeader: req.get('stripe-signature'),
      secret: secretFor(account, env.STRIPE_WEBHOOK_SECRET),
    });

    if (!verification.valid) {
      return rejectBadSignature({
        res,
        companyId: account.companyId,
        provider: 'STRIPE',
        accountId,
        reason: verification.reason ?? 'unknown',
      });
    }

    const event = normalizeStripeEvent(req.body as Record<string, unknown>);
    const recorded = await recordWebhookEvent({
      providerAccountId: account.id,
      provider: 'STRIPE',
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      signatureValid: true,
      payload: req.body,
    });

    if (recorded.isDuplicate) {
      return res.status(200).json({ data: { status: 'duplicate', eventId: event.externalEventId } });
    }

    await prisma.paymentProviderAccount.update({
      where: { id: account.id },
      data: { lastWebhookAt: new Date(), isVerified: true },
    });

    const outcome = await processPaymentEvent({
      companyId: account.companyId,
      providerAccountId: account.id,
      webhookEventId: recorded.id,
      event,
    });

    return res.status(200).json({ data: outcome });
  }),
);

/**
 * @openapi
 * /webhooks/razorpay/{accountId}:
 *   post:
 *     tags: [Webhooks]
 *     summary: Razorpay webhook endpoint
 *     description: >
 *       Verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body). Razorpay
 *       sends no timestamp, so replay protection relies on event-id idempotency.
 *     security: []
 *     responses:
 *       200: { description: Event received }
 *       400: { description: Signature verification failed }
 */
webhooksRouter.post(
  '/razorpay/:accountId',
  webhookRateLimit,
  validate({ params: accountParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.params as { accountId: string };
    const account = await loadAccount(accountId);
    const rawBody = req.rawBody ?? Buffer.from('');

    const verification = verifyRazorpaySignature({
      rawBody,
      signatureHeader: req.get('x-razorpay-signature'),
      secret: secretFor(account, env.RAZORPAY_WEBHOOK_SECRET),
    });

    if (!verification.valid) {
      return rejectBadSignature({
        res,
        companyId: account.companyId,
        provider: 'RAZORPAY',
        accountId,
        reason: verification.reason ?? 'unknown',
      });
    }

    const event = normalizeRazorpayEvent(req.body as Record<string, unknown>);
    const recorded = await recordWebhookEvent({
      providerAccountId: account.id,
      provider: 'RAZORPAY',
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      signatureValid: true,
      payload: req.body,
    });

    if (recorded.isDuplicate) {
      return res.status(200).json({ data: { status: 'duplicate', eventId: event.externalEventId } });
    }

    await prisma.paymentProviderAccount.update({
      where: { id: account.id },
      data: { lastWebhookAt: new Date(), isVerified: true },
    });

    const outcome = await processPaymentEvent({
      companyId: account.companyId,
      providerAccountId: account.id,
      webhookEventId: recorded.id,
      event,
    });

    return res.status(200).json({ data: outcome });
  }),
);

/**
 * @openapi
 * /webhooks/google-play/{accountId}:
 *   post:
 *     tags: [Webhooks]
 *     summary: Google Play Pub/Sub push endpoint
 *     description: >
 *       INCOMPLETE BY DESIGN. The push body carries a purchase token and product
 *       id but no amount; the real figure needs a Play Developer API lookup,
 *       which this build does not perform. Events are recorded for audit and
 *       marked unhandled — no revenue is invented. Full OIDC JWT verification
 *       is also outstanding. See docs/payment-integrations.md.
 *     security: []
 *     responses:
 *       200: { description: Notification recorded, not converted into revenue }
 *       400: { description: Verification token mismatch }
 */
webhooksRouter.post(
  '/google-play/:accountId',
  webhookRateLimit,
  validate({ params: accountParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.params as { accountId: string };
    const account = await loadAccount(accountId);

    const verification = verifyGooglePlayPush({
      verificationToken:
        (req.query.token as string | undefined) ?? req.get('x-goog-verification-token') ?? undefined,
      expectedToken: secretFor(account, env.GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN),
    });

    if (!verification.valid) {
      return rejectBadSignature({
        res,
        companyId: account.companyId,
        provider: 'GOOGLE_PLAY',
        accountId,
        reason: verification.reason ?? 'unknown',
      });
    }

    const event = normalizeGooglePlayEvent(req.body as Record<string, unknown>);
    const recorded = await recordWebhookEvent({
      providerAccountId: account.id,
      provider: 'GOOGLE_PLAY',
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      // Deliberately false: the shared token is not a cryptographic signature.
      signatureValid: false,
      payload: req.body,
    });

    if (recorded.isDuplicate) {
      return res.status(200).json({ data: { status: 'duplicate', eventId: event.externalEventId } });
    }

    await prisma.webhookEvent.update({
      where: { id: recorded.id },
      data: {
        status: 'NEEDS_REVIEW',
        lastError:
          'Google Play notifications carry no amount. Completing this integration requires a Play Developer API lookup — see docs/payment-integrations.md.',
      },
    });

    return res.status(200).json({
      data: {
        status: 'recorded',
        message: 'Notification stored for audit. No revenue was recorded — integration incomplete.',
        eventId: event.externalEventId,
      },
    });
  }),
);

/**
 * @openapi
 * /webhooks/generic/{accountId}:
 *   post:
 *     tags: [Webhooks]
 *     summary: Endpoint for your own app backends to report verified payments
 *     description: >
 *       For apps that run their own payment flow. Sign the raw body as
 *       `HMAC-SHA256("<timestamp>.<body>", secret)` and send it in
 *       `X-Signature` with the unix seconds in `X-Timestamp`. Amounts are
 *       decimal strings in MAJOR units. See docs/payment-integrations.md.
 *     security: []
 *     responses:
 *       200: { description: Event received }
 *       400: { description: Signature verification failed }
 */
webhooksRouter.post(
  '/generic/:accountId',
  webhookRateLimit,
  validate({ params: accountParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { accountId } = req.params as { accountId: string };
    const account = await loadAccount(accountId);
    const rawBody = req.rawBody ?? Buffer.from('');

    const verification = verifyGenericHmac({
      rawBody,
      signature: req.get('x-signature'),
      timestamp: req.get('x-timestamp'),
      secret: secretFor(account),
    });

    if (!verification.valid) {
      return rejectBadSignature({
        res,
        companyId: account.companyId,
        provider: 'OTHER',
        accountId,
        reason: verification.reason ?? 'unknown',
      });
    }

    const event = normalizeGenericEvent(req.body as Record<string, unknown>);
    const recorded = await recordWebhookEvent({
      providerAccountId: account.id,
      provider: 'OTHER',
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      signatureValid: true,
      payload: req.body,
    });

    if (recorded.isDuplicate) {
      return res.status(200).json({ data: { status: 'duplicate', eventId: event.externalEventId } });
    }

    await prisma.paymentProviderAccount.update({
      where: { id: account.id },
      data: { lastWebhookAt: new Date(), isVerified: true },
    });

    const outcome = await processPaymentEvent({
      companyId: account.companyId,
      providerAccountId: account.id,
      webhookEventId: recorded.id,
      event,
    });

    return res.status(200).json({ data: outcome });
  }),
);
