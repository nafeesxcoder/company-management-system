import 'dotenv/config';
import { z } from 'zod';

/**
 * Fail-fast environment validation.
 *
 * The process refuses to start with a missing or weak secret. That is deliberate:
 * a financial API that boots with a default JWT secret is worse than one that
 * does not boot at all.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csvList = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PREFIX: z.string().default('/api/v1'),

    // --- Database -----------------------------------------------------------
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),

    // --- Auth ---------------------------------------------------------------
    ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be at least 32 characters'),
    REFRESH_TOKEN_SECRET: z.string().min(32, 'REFRESH_TOKEN_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    JWT_ISSUER: z.string().default('cms-api'),
    JWT_AUDIENCE: z.string().default('cms-clients'),

    /** AES-256-GCM key (64 hex chars) used to encrypt payment provider secrets at rest. */
    APP_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

    // --- HTTP ---------------------------------------------------------------
    WEB_ORIGIN: csvList.default('http://localhost:3000'),
    COOKIE_DOMAIN: z.string().optional(),
    TRUST_PROXY: booleanish.default(false),

    // --- Rate limiting ------------------------------------------------------
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),

    // --- Logging ------------------------------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    LOG_PRETTY: booleanish.default(false),

    // --- Money / locale -----------------------------------------------------
    DEFAULT_CURRENCY: z.string().length(3).default('INR'),
    DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),

    // --- Payment providers (optional until configured) ----------------------
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    GOOGLE_PLAY_PUBSUB_VERIFICATION_TOKEN: z.string().optional(),

    /** Max age (seconds) a provider webhook timestamp may be before we reject it as a replay. */
    WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).default(300),

    SWAGGER_ENABLED: booleanish.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.ACCESS_TOKEN_SECRET === env.REFRESH_TOKEN_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REFRESH_TOKEN_SECRET'],
          message: 'ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must differ in production',
        });
      }
      if (env.WEB_ORIGIN.some((o) => o.startsWith('http://') && !o.includes('localhost'))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEB_ORIGIN'],
          message: 'Production origins must use HTTPS',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`\n✖ Invalid environment configuration:\n${details}\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
