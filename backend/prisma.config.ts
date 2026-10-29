import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration.
 *
 * Migrations live in prisma/migrations/ and are applied with:
 *   - development:  npm run prisma:migrate   (prisma migrate dev)
 *   - production:   npm run prisma:deploy    (prisma migrate deploy)
 *
 * `prisma db push` is never used as a deployment strategy.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
