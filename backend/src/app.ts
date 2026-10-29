import express, { type Express, type Request } from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { openApiSpec } from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalRateLimit } from './middleware/rate-limit.js';
import { httpLogger, requestId } from './middleware/request-context.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

/**
 * Express application assembly.
 *
 * Order matters:
 *   1. security headers and request id
 *   2. raw body capture for webhook signature verification (BEFORE json parsing)
 *   3. json/urlencoded parsing for everything else
 *   4. routes
 *   5. 404, then the central error handler
 */
export function createApp(): Express {
  const app = express();

  // Required for correct client IPs (rate limiting, audit logs) behind a proxy.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI needs inline styles/scripts; the API serves no other HTML.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      // Non-browser callers (mobile app, curl, server-to-server) send no Origin.
      if (!origin) return callback(null, true);
      if (env.WEB_ORIGIN.includes(origin)) return callback(null, true);
      logger.warn({ origin }, 'Blocked CORS request from a disallowed origin');
      return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true, // required for the HttpOnly refresh cookie
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  };
  app.use(cors(corsOptions));

  app.use(compression());

  /**
   * Webhook routes need the EXACT bytes the provider signed. Capturing the raw
   * buffer here, before express.json(), is what makes signature verification
   * possible — a re-serialised body would not match the signature.
   */
  app.use(
    `${env.API_PREFIX}/webhooks`,
    express.raw({ type: '*/*', limit: '2mb' }),
    (req: Request, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        req.rawBody = req.body;
        try {
          req.body = req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
        } catch {
          req.body = {};
        }
      }
      next();
    },
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  app.use(globalRateLimit);

  // --- Health probes (unversioned, unauthenticated) -------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', (_req, res) => {
    void prisma
      .$queryRaw`SELECT 1`
      .then(() => res.json({ status: 'ready', database: 'connected' }))
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Readiness probe failed');
        res.status(503).json({ status: 'unavailable', database: 'disconnected' });
      });
  });

  // --- API documentation ----------------------------------------------------
  if (env.SWAGGER_ENABLED) {
    app.get(`${env.API_PREFIX}/docs.json`, (_req, res) => res.json(openApiSpec));
    app.use(
      `${env.API_PREFIX}/docs`,
      swaggerUi.serve,
      swaggerUi.setup(openApiSpec, {
        customSiteTitle: 'Company Management System API',
        swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
      }),
    );
  }

  // --- Versioned API --------------------------------------------------------
  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
