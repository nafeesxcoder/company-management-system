import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma, prisma } from './config/prisma.js';
import { startRetryWorker, stopRetryWorker } from './modules/payment-providers/retry-worker.js';
import { logger } from './utils/logger.js';

/**
 * Process entry point: verify the database is reachable, start listening, and
 * shut down cleanly so in-flight financial writes are never cut off mid-request.
 */

async function assertDatabaseReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection established');
  } catch (error) {
    logger.fatal({ err: error }, 'Cannot reach the database — refusing to start');
    throw error;
  }
}

async function main(): Promise<void> {
  await assertDatabaseReachable();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, apiPrefix: env.API_PREFIX },
      `API listening on http://localhost:${env.PORT}${env.API_PREFIX}`,
    );
    if (env.SWAGGER_ENABLED) {
      logger.info(`API documentation at http://localhost:${env.PORT}${env.API_PREFIX}/docs`);
    }
  });

  // Above the typical 60s load-balancer idle timeout, to avoid 502s on races.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // Reprocesses webhook events that verified but failed to persist. Started
  // here rather than in createApp() so importing the app in a test does not
  // start a background timer.
  startRetryWorker();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    stopRetryWorker();

    const force = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 15s — forcing exit');
      process.exit(1);
    }, 15_000);
    force.unref();

    server.close((closeError) => {
      if (closeError) logger.error({ err: closeError }, 'Error while closing the HTTP server');
      void disconnectPrisma()
        .then(() => {
          logger.info('Shutdown complete');
          process.exit(closeError ? 1 : 0);
        })
        .catch((error: unknown) => {
          logger.error({ err: error }, 'Error disconnecting from the database');
          process.exit(1);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Fatal error during startup');
  process.exit(1);
});
