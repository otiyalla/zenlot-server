#!/usr/bin/env ts-node
/**
 * Read-only migration status check.
 *
 * Maps the environment-specific database URL to DATABASE_URL (same mapping as
 * scripts/migrate-prod.ts) and runs `prisma migrate status`. This NEVER writes
 * to the database or the filesystem — safe to run against production.
 *
 * Usage (via package.json):
 *   yarn db:migrate:status:local
 *   yarn db:migrate:status:dev
 *   yarn db:migrate:status:prod
 *
 * Exit code: 0 when the database is up to date, non-zero when migrations are
 * pending/failed or the database is unreachable (useful for CI gating).
 */
import { config } from 'dotenv';
import { execSync } from 'child_process';
import { resolve } from 'path';

type Env = 'local' | 'dev' | 'prod';

function getEnvironment(): Env {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  if (nodeEnv === 'local') return 'local';
  if (nodeEnv === 'dev' || nodeEnv === 'development') return 'dev';
  // Default to prod, matching scripts/migrate-prod.ts.
  return 'prod';
}

const env = getEnvironment();
const rootDir = resolve(__dirname, '..');

// Load the environment-specific file first, then .env as a fallback. dotenv does
// not override already-set vars, so the environment-specific file wins.
if (env === 'local') {
  config({ path: resolve(rootDir, '.env.local') });
} else if (env === 'dev') {
  config({ path: resolve(rootDir, '.env.dev') });
} else {
  config({ path: resolve(rootDir, '.env.prod') });
}
config({ path: resolve(rootDir, '.env') });

function resolveDatabaseUrl(): string {
  // Respect an explicit DATABASE_URL if the caller already set one.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const varNameByEnv: Record<Env, string> = {
    local: 'LOCAL_DB_URL',
    dev: 'DEV_PRISMA_DB',
    prod: 'PRISMA_POSTRES_ZENLOT_DB',
  };
  const varName = varNameByEnv[env];
  const url = process.env[varName];
  if (!url) {
    throw new Error(
      `${varName} is not set for ${env} environment. ` +
        `DATABASE_URL must be resolvable to check migration status.`,
    );
  }
  return url;
}

const databaseUrl = resolveDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

// Log which DB we're hitting, with credentials masked (handles both
// user:pass@host URLs and Accelerate api_key URLs).
const masked = databaseUrl
  .replace(/(:\/\/[^:/?#]+:)[^@]+(@)/, '$1***$2')
  .replace(/(api_key=)[^&"'\s]+/, '$1***');
console.log(`[migrate:status] environment = ${env}`);
console.log(`[migrate:status] DATABASE_URL = ${masked}`);

try {
  // prisma.config.ts resolves the datasource url from process.env.DATABASE_URL,
  // which we set above. Pass the full env through so it's inherited.
  execSync('prisma migrate status --config prisma/prisma.config.ts', {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
  });
} catch (err) {
  // `prisma migrate status` exits non-zero when there are pending/failed
  // migrations or the DB is unreachable. Propagate that code instead of a stack.
  const status = (err as { status?: number }).status;
  process.exit(typeof status === 'number' ? status : 1);
}
