import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { encryptSecret } from '../../utils/crypto.js';
import { conflict, notFound } from '../../utils/errors.js';
import { asyncHandler, buildPaginationMeta, created, noContent, ok, paginated } from '../../utils/http.js';
import { authenticate } from '../../middleware/authenticate.js';
import { companyScope, requireAdmin, requireCompanyContext } from '../../middleware/company-scope.js';
import { validate } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../utils/pagination.js';
import { auditFromRequest } from '../../services/audit.service.js';

/**
 * Payment integration management.
 *
 * Secrets go in encrypted and NEVER come back out. Every response exposes only
 * booleans — `hasApiKey`, `hasWebhookSecret` — so a compromised browser session
 * or a screenshot cannot leak the ability to forge webhooks.
 */
export const providersRouter: Router = Router();
providersRouter.use(authenticate, companyScope);

const PROVIDERS = ['STRIPE', 'RAZORPAY', 'GOOGLE_PLAY', 'MANUAL_BANK', 'OTHER'] as const;

const createAccountSchema = z.object({
  provider: z.enum(PROVIDERS),
  label: z.string().trim().min(2).max(120),
  externalAccountId: z.string().trim().max(191).nullish(),
  apiKey: z.string().trim().min(8).max(500).nullish(),
  webhookSecret: z.string().trim().min(8).max(500).nullish(),
});

const updateAccountSchema = z
  .object({
    label: z.string().trim().min(2).max(120).optional(),
    externalAccountId: z.string().trim().max(191).nullish(),
    apiKey: z.string().trim().min(8).max(500).nullish(),
    webhookSecret: z.string().trim().min(8).max(500).nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

const mappingSchema = z.object({
  projectId: z.string().uuid(),
  externalProductId: z.string().trim().min(1).max(191),
  label: z.string().trim().max(160).nullish(),
});

/** Shapes an account for the API. Secrets become booleans. */
function present(account: {
  id: string;
  provider: string;
  label: string;
  externalAccountId: string | null;
  apiKeyCiphertext: string | null;
  webhookSecretCiphertext: string | null;
  isActive: boolean;
  isVerified: boolean;
  lastWebhookAt: Date | null;
  createdAt: Date;
  _count?: { productMappings: number; transactions: number };
}) {
  const webhookPath =
    account.provider === 'STRIPE'
      ? 'stripe'
      : account.provider === 'RAZORPAY'
        ? 'razorpay'
        : account.provider === 'GOOGLE_PLAY'
          ? 'google-play'
          : 'generic';

  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    externalAccountId: account.externalAccountId,
    hasApiKey: Boolean(account.apiKeyCiphertext),
    hasWebhookSecret: Boolean(account.webhookSecretCiphertext),
    isActive: account.isActive,
    /** True only once a correctly-signed event has actually been received. */
    isVerified: account.isVerified,
    lastWebhookAt: account.lastWebhookAt,
    createdAt: account.createdAt,
    productMappingCount: account._count?.productMappings ?? 0,
    transactionCount: account._count?.transactions ?? 0,
    webhookUrl: `${env.API_PREFIX}/webhooks/${webhookPath}/${account.id}`,
    /**
     * Honest readiness, rather than a green tick for a half-finished setup.
     */
    readiness: {
      credentialsStored: Boolean(account.webhookSecretCiphertext),
      productMappingsConfigured: (account._count?.productMappings ?? 0) > 0,
      signedEventReceived: account.isVerified,
      ready:
        Boolean(account.webhookSecretCiphertext) &&
        (account._count?.productMappings ?? 0) > 0 &&
        account.isVerified,
    },
  };
}

const ACCOUNT_SELECT = {
  id: true,
  provider: true,
  label: true,
  externalAccountId: true,
  apiKeyCiphertext: true,
  webhookSecretCiphertext: true,
  isActive: true,
  isVerified: true,
  lastWebhookAt: true,
  createdAt: true,
  _count: { select: { productMappings: true, transactions: true } },
} as const;

/**
 * @openapi
 * /payment-providers:
 *   get:
 *     tags: [Payment Providers]
 *     summary: List configured payment integrations
 *     description: >
 *       Secrets are never returned — only `hasApiKey` / `hasWebhookSecret`
 *       booleans and a `readiness` block stating exactly which setup steps are
 *       still outstanding.
 *     responses:
 *       200: { description: Provider accounts }
 */
providersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const accounts = await prisma.paymentProviderAccount.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: ACCOUNT_SELECT,
    });
    return ok(res, accounts.map(present));
  }),
);

/**
 * @openapi
 * /payment-providers:
 *   post:
 *     tags: [Payment Providers]
 *     summary: Add a payment integration
 *     description: Secrets are encrypted with AES-256-GCM before they reach the database.
 *     responses:
 *       201: { description: Integration created, with its webhook URL }
 */
providersRouter.post(
  '/',
  requireAdmin,
  validate({ body: createAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const input = req.body as z.infer<typeof createAccountSchema>;

    const duplicate = await prisma.paymentProviderAccount.findFirst({
      where: { companyId, provider: input.provider, label: input.label },
      select: { id: true },
    });
    if (duplicate) throw conflict(`A ${input.provider} integration labelled "${input.label}" already exists`);

    const account = await prisma.paymentProviderAccount.create({
      data: {
        companyId,
        provider: input.provider,
        label: input.label,
        externalAccountId: input.externalAccountId ?? null,
        apiKeyCiphertext: input.apiKey ? encryptSecret(input.apiKey) : null,
        webhookSecretCiphertext: input.webhookSecret ? encryptSecret(input.webhookSecret) : null,
      },
      select: ACCOUNT_SELECT,
    });

    await auditFromRequest(req, {
      action: 'provider.create',
      entityType: 'PaymentProviderAccount',
      entityId: account.id,
      summary: `Added ${input.provider} integration "${input.label}"`,
      // The audit scrubber redacts secrets; only the booleans are recorded.
      after: { provider: input.provider, label: input.label },
    });

    return created(res, present(account));
  }),
);

/**
 * @openapi
 * /payment-providers/{id}:
 *   patch:
 *     tags: [Payment Providers]
 *     summary: Update an integration or rotate its secrets
 *     responses:
 *       200: { description: Updated }
 */
providersRouter.patch(
  '/:id',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }), body: updateAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof updateAccountSchema>;

    const existing = await prisma.paymentProviderAccount.findFirst({
      where: { id, companyId },
      select: ACCOUNT_SELECT,
    });
    if (!existing) throw notFound('Payment provider account');

    const rotatedSecret = input.webhookSecret !== undefined && input.webhookSecret !== null;

    const updated = await prisma.paymentProviderAccount.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.externalAccountId !== undefined
          ? { externalAccountId: input.externalAccountId }
          : {}),
        ...(input.apiKey !== undefined
          ? { apiKeyCiphertext: input.apiKey ? encryptSecret(input.apiKey) : null }
          : {}),
        ...(input.webhookSecret !== undefined
          ? {
              webhookSecretCiphertext: input.webhookSecret ? encryptSecret(input.webhookSecret) : null,
              // A rotated secret must be re-proven by a real signed event.
              isVerified: false,
            }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: ACCOUNT_SELECT,
    });

    await auditFromRequest(req, {
      action: rotatedSecret ? 'provider.secret_rotated' : 'provider.update',
      entityType: 'PaymentProviderAccount',
      entityId: id,
      summary: rotatedSecret
        ? `Rotated the webhook secret for "${updated.label}" — verification reset`
        : `Updated integration "${updated.label}"`,
    });

    return ok(res, present(updated));
  }),
);

/**
 * @openapi
 * /payment-providers/{id}:
 *   delete:
 *     tags: [Payment Providers]
 *     summary: Remove an integration
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: Transactions reference this integration }
 */
providersRouter.delete(
  '/:id',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };

    const existing = await prisma.paymentProviderAccount.findFirst({
      where: { id, companyId },
      select: ACCOUNT_SELECT,
    });
    if (!existing) throw notFound('Payment provider account');

    if ((existing._count?.transactions ?? 0) > 0) {
      throw conflict(
        `${existing._count.transactions} transaction(s) reference this integration. ` +
          'Deactivate it instead so the payment history stays traceable.',
      );
    }

    await prisma.paymentProviderAccount.delete({ where: { id } });

    await auditFromRequest(req, {
      action: 'provider.delete',
      entityType: 'PaymentProviderAccount',
      entityId: id,
      summary: `Deleted integration "${existing.label}"`,
    });

    return noContent(res);
  }),
);

/**
 * @openapi
 * /payment-providers/{id}/mappings:
 *   get:
 *     tags: [Payment Providers]
 *     summary: Product-to-project mappings for this integration
 *     description: >
 *       These mappings are the ONLY way an incoming payment is attributed to a
 *       project. Without one, a payment is recorded but flagged for review.
 *     responses:
 *       200: { description: Mappings }
 */
providersRouter.get(
  '/:id/mappings',
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };

    const account = await prisma.paymentProviderAccount.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!account) throw notFound('Payment provider account');

    const mappings = await prisma.providerProductMapping.findMany({
      where: { providerAccountId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        externalProductId: true,
        label: true,
        isActive: true,
        createdAt: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });

    return ok(res, mappings);
  }),
);

/**
 * @openapi
 * /payment-providers/{id}/mappings:
 *   post:
 *     tags: [Payment Providers]
 *     summary: Map a provider product/price/plan to a project
 *     responses:
 *       201: { description: Mapping created }
 *       409: { description: That product is already mapped }
 */
providersRouter.post(
  '/:id/mappings',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid() }), body: mappingSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id } = req.params as { id: string };
    const input = req.body as z.infer<typeof mappingSchema>;

    const [account, project] = await Promise.all([
      prisma.paymentProviderAccount.findFirst({
        where: { id, companyId },
        select: { id: true, provider: true },
      }),
      prisma.project.findFirst({ where: { id: input.projectId, companyId }, select: { id: true } }),
    ]);

    if (!account) throw notFound('Payment provider account');
    if (!project) throw notFound('Project');

    const duplicate = await prisma.providerProductMapping.findFirst({
      where: { providerAccountId: id, externalProductId: input.externalProductId },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict(`Product "${input.externalProductId}" is already mapped for this integration`);
    }

    const mapping = await prisma.providerProductMapping.create({
      data: {
        providerAccountId: id,
        provider: account.provider,
        projectId: input.projectId,
        externalProductId: input.externalProductId,
        label: input.label ?? null,
      },
      select: {
        id: true,
        externalProductId: true,
        label: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });

    await auditFromRequest(req, {
      action: 'provider.mapping_create',
      entityType: 'ProviderProductMapping',
      entityId: mapping.id,
      summary: `Mapped product "${input.externalProductId}" to project ${mapping.project.code}`,
      after: mapping,
    });

    return created(res, mapping);
  }),
);

/**
 * @openapi
 * /payment-providers/{id}/mappings/{mappingId}:
 *   delete:
 *     tags: [Payment Providers]
 *     summary: Remove a product mapping
 *     responses:
 *       204: { description: Deleted }
 */
providersRouter.delete(
  '/:id/mappings/:mappingId',
  requireAdmin,
  validate({ params: z.object({ id: z.string().uuid(), mappingId: z.string().uuid() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const { id, mappingId } = req.params as { id: string; mappingId: string };

    const mapping = await prisma.providerProductMapping.findFirst({
      where: { id: mappingId, providerAccountId: id, providerAccount: { companyId } },
      select: { id: true, externalProductId: true },
    });
    if (!mapping) throw notFound('Product mapping');

    await prisma.providerProductMapping.delete({ where: { id: mappingId } });

    await auditFromRequest(req, {
      action: 'provider.mapping_delete',
      entityType: 'ProviderProductMapping',
      entityId: mappingId,
      summary: `Removed mapping for product "${mapping.externalProductId}"`,
    });

    return noContent(res);
  }),
);

/**
 * @openapi
 * /payment-providers/webhook-events:
 *   get:
 *     tags: [Webhooks]
 *     summary: Webhook delivery log
 *     description: Every event received, with its signature result and processing outcome.
 *     parameters:
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *       - { in: query, name: status, schema: { type: string, enum: [RECEIVED, PROCESSED, FAILED, IGNORED, NEEDS_REVIEW] } }
 *     responses:
 *       200: { description: Paginated webhook events }
 */
providersRouter.get(
  '/webhook-events',
  validate({
    query: paginationQuerySchema.extend({
      status: z.enum(['RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED', 'NEEDS_REVIEW']).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = requireCompanyContext(req);
    const query = req.query as unknown as { page: number; pageSize: number; status?: string };

    const where = {
      providerAccount: { companyId },
      ...(query.status ? { status: query.status as never } : {}),
    };

    const [items, totalItems] = await Promise.all([
      prisma.webhookEvent.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { receivedAt: 'desc' },
        select: {
          id: true,
          provider: true,
          externalEventId: true,
          eventType: true,
          signatureValid: true,
          status: true,
          attempts: true,
          lastError: true,
          receivedAt: true,
          processedAt: true,
          providerAccount: { select: { id: true, label: true } },
        },
      }),
      prisma.webhookEvent.count({ where }),
    ]);

    return paginated(res, items, buildPaginationMeta(query.page, query.pageSize, totalItems));
  }),
);
