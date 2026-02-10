#!/usr/bin/env ts-node
/**
 * Production migration script
 * Maps environment-specific database URL to DATABASE_URL before running migrations
 */

import { config } from 'dotenv';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { writeFileSync, unlinkSync, existsSync } from 'fs';

function getEnvironment(): 'local' | 'dev' | 'prod' {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();

  if (nodeEnv === 'local') {
    return 'local';
  } else if (nodeEnv === 'dev' || nodeEnv === 'development') {
    return 'dev';
  } else if (nodeEnv === 'prod' || nodeEnv === 'production') {
    return 'prod';
  }

  // Default to prod for production migrations
  return 'prod';
}

// Load environment files based on NODE_ENV
function loadEnvFiles(): void {
  const env = getEnvironment();
  const rootDir = resolve(__dirname, '..');

  // Load environment-specific file first, then .env as fallback
  if (env === 'local') {
    config({ path: resolve(rootDir, '.env.local') });
  } else if (env === 'dev') {
    config({ path: resolve(rootDir, '.env.dev') });
  } else if (env === 'prod') {
    config({ path: resolve(rootDir, '.env.prod') });
  }

  // Always load .env as fallback
  config({ path: resolve(rootDir, '.env') });
}

function mapDatabaseUrl(): void {
  const env = getEnvironment();
  let databaseUrl: string | undefined;
  let shadowDatabaseUrl: string | undefined;

  // If DATABASE_URL is already set, use it
  if (process.env.DATABASE_URL) {
    console.log(`DATABASE_URL is already set. Environment: ${env}`);
    return;
  }

  switch (env) {
    case 'local':
      databaseUrl = process.env.LOCAL_DB_URL;
      shadowDatabaseUrl = process.env.LOCAL_SHADOW_DB_URL;
      break;
    case 'dev':
      databaseUrl = process.env.DEV_PRISMA_DB;
      shadowDatabaseUrl = process.env.DEV_SHADOW_DB_URL;
      break;
    case 'prod':
      databaseUrl = process.env.PRISMA_POSTRES_ZENLOT_DB;
      shadowDatabaseUrl = process.env.PRISMA_POSTRES_ZENLOT_SHADOW_DB;
      break;
  }

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl;
    console.log(`Mapped DATABASE_URL for ${env} environment`);

    if (shadowDatabaseUrl) {
      process.env.SHADOW_DATABASE_URL = shadowDatabaseUrl;
      console.log(`Mapped SHADOW_DATABASE_URL for ${env} environment`);
    }
  } else {
    const envVar =
      env === 'local'
        ? 'LOCAL_DB_URL'
        : env === 'dev'
          ? 'DEV_PRISMA_DB'
          : 'PRISMA_POSTRES_ZENLOT_DB';

    throw new Error(
      `${envVar} is not set for ${env} environment. ` +
        `DATABASE_URL must be set to run migrations.`,
    );
  }
}

// Load environment files
loadEnvFiles();

// Map database URL
mapDatabaseUrl();

// Verify DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error(
    'ERROR: DATABASE_URL is not set after mapping. Cannot run migrations.',
  );
  process.exit(1);
}

// Log the DATABASE_URL (masked for security)
const maskedUrl = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2')
  : 'not set';
console.log(`DATABASE_URL is set: ${maskedUrl}`);

// Write DATABASE_URL to .env file in prisma directory
// Prisma reads .env files from the prisma directory or project root
const rootDir = resolve(__dirname, '..');
const prismaDir = resolve(rootDir, 'prisma');
const prismaEnvFile = resolve(prismaDir, '.env');

// Check if .env already exists in prisma directory
const envFileExists = existsSync(prismaEnvFile);
let originalEnvContent: string | null = null;

try {
  // Backup existing .env file if it exists
  if (envFileExists) {
    originalEnvContent = require('fs').readFileSync(prismaEnvFile, 'utf8');
  }

  // Write .env file with DATABASE_URL
  const envContent = [
    `DATABASE_URL="${process.env.DATABASE_URL}"`,
    process.env.SHADOW_DATABASE_URL
      ? `SHADOW_DATABASE_URL="${process.env.SHADOW_DATABASE_URL}"`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  writeFileSync(prismaEnvFile, envContent, 'utf8');
  console.log('Created .env file in prisma directory for Prisma');

  // Run Prisma migrate deploy with DATABASE_URL explicitly in environment
  console.log('Running Prisma migrate deploy...');

  // Ensure all environment variables are passed, with DATABASE_URL explicitly set
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL!,
    SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  };

  execSync('prisma migrate deploy --config prisma/prisma.config.ts', {
    stdio: 'inherit',
    cwd: rootDir,
    env,
  });
  console.log('Migration completed successfully');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  // Restore original .env file or remove the one we created
  if (envFileExists && originalEnvContent !== null) {
    writeFileSync(prismaEnvFile, originalEnvContent, 'utf8');
    console.log('Restored original .env file in prisma directory');
  } else if (existsSync(prismaEnvFile) && !envFileExists) {
    unlinkSync(prismaEnvFile);
    console.log('Removed temporary .env file from prisma directory');
  }
}
