/**
 * Test bootstrap.
 *
 * `.env.test` is loaded with `override: true` BEFORE anything imports
 * src/config/env.ts. Without the override a developer's `.env` would win and
 * the suite would happily truncate the development database.
 */
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '.env.test'), override: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'mysql://cms:cmspass@127.0.0.1:3306/company_management_test';
process.env.ACCESS_TOKEN_SECRET ??= 'test-access-secret-that-is-long-enough-32chars';
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-that-is-long-enough-32chars';
process.env.APP_ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.LOG_LEVEL = 'silent';
process.env.SWAGGER_ENABLED = 'false';

// Last line of defence: refuse to run against anything not named like a test DB.
const url = process.env.DATABASE_URL ?? '';
if (!/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ''))) {
  throw new Error(
    `Refusing to run tests against "${new URL(url).pathname}" — the database name must end in "_test".`,
  );
}
