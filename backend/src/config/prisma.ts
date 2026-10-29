import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { env, isProduction } from './env.js';

/**
 * Single Prisma client for the process.
 *
 * Connection goes through the MariaDB driver adapter, which speaks the MySQL
 * protocol and connects to MySQL 8. Only this backend ever opens a database
 * connection — neither the web frontend nor the Flutter app has credentials.
 */

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:') {
    throw new Error(`DATABASE_URL must use the mysql:// protocol, received "${parsed.protocol}"`);
  }
  const ssl = parsed.searchParams.get('ssl') ?? parsed.searchParams.get('sslaccept');

  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname.replace(/^\//, ''),
    connectionLimit: env.DATABASE_POOL_LIMIT,
    connectTimeout: env.DATABASE_CONNECT_TIMEOUT_MS,
    // Managed MySQL (RDS, PlanetScale, Aiven) generally requires TLS.
    ...(ssl && ssl !== 'false' ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}

export const prismaAdapter = new PrismaMariaDb(parseDatabaseUrl(env.DATABASE_URL));

export const prisma = new PrismaClient({
  adapter: prismaAdapter,
  log: isProduction ? ['error', 'warn'] : ['error', 'warn'],
});

/**
 * Accepts either the root client or an open interactive transaction, so a
 * service function can be called standalone or composed into a larger atomic
 * operation without a second implementation.
 */
export type Db = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$transaction' | '$extends' | '$on' | '$use'
>;

export type PrismaTransactionClient = Db;

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
