/**
 * Database URL mapping based on environment
 * Maps environment-specific database URL variables to DATABASE_URL
 * for Prisma to use
 */

function getEnvironment(): 'local' | 'dev' | 'prod' {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();

  if (nodeEnv === 'local') {
    return 'local';
  } else if (nodeEnv === 'dev' || nodeEnv === 'development') {
    return 'dev';
  } else if (nodeEnv === 'prod' || nodeEnv === 'production') {
    return 'prod';
  }

  return 'local';
}

/**
 * Maps environment-specific database URL variables to DATABASE_URL
 * This must be called before Prisma client initialization
 */
export function mapDatabaseUrl(): void {
  const env = getEnvironment();
  let databaseUrl: string | undefined;
  let shadowDatabaseUrl: string | undefined;

  if (process.env.DATABASE_URL) {
    console.log(
      `DATABASE_URL is already set, skipping auto-mapping. Environment: ${env}`,
    );
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

    if (shadowDatabaseUrl) {
      process.env.SHADOW_DATABASE_URL = shadowDatabaseUrl;
    }
  } else {
    const envVar =
      env === 'local'
        ? 'LOCAL_DB_URL'
        : env === 'dev'
          ? 'DEV_PRISMA_DB'
          : 'PRISMA_POSTRES_ZENLOT_DB';

    console.log(
      `Warning: ${envVar} is not set for ${env} environment. ` +
        `DATABASE_URL will not be set automatically.`,
    );
  }
}
