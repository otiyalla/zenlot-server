import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import Redis, { RedisOptions } from 'ioredis';

const TRUTHY = ['1', 'true', 'yes'];

/**
 * Connection options shared by every Redis client the app opens, built from
 * REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD / REDIS_TLS /
 * REDIS_TLS_REJECT_UNAUTHORIZED.
 */
export function buildRedisOptions(config: ConfigService): RedisOptions {
  const host = config.get<string>('REDIS_HOST');
  const port = Number(config.get<string>('REDIS_PORT') ?? 6379);
  const username = config.get<string>('REDIS_USERNAME');
  const password = config.get<string>('REDIS_PASSWORD');
  const tlsEnabled = TRUTHY.includes(
    (config.get<string>('REDIS_TLS') ?? '').toLowerCase(),
  );
  const rejectUnauthorized =
    (
      config.get<string>('REDIS_TLS_REJECT_UNAUTHORIZED') ?? 'true'
    ).toLowerCase() !== 'false';

  return {
    host,
    port,
    username,
    password,
    ...(tlsEnabled ? { tls: { servername: host, rejectUnauthorized } } : {}),
  };
}

/**
 * Reports a Redis client's errors to Sentry once per outage instead of once
 * per reconnect attempt. ioredis retries about every 2 seconds, so a refused
 * connection otherwise floods Sentry (NODE-NESTJS-2N logged 497 events in
 * 20 minutes). Retries after the first error are logged at debug level, and
 * recovery is logged once the client is ready again.
 */
export function reportRedisErrors(
  client: Redis,
  logger: Logger,
  context: string,
): void {
  let failedAttempts = 0;

  client.on('error', (error: Error) => {
    failedAttempts += 1;
    if (failedAttempts > 1) {
      logger.debug(
        `${context} Redis error (attempt ${failedAttempts}): ${error.message}`,
      );
      return;
    }
    logger.error(`${context} Redis error`, error);
    Sentry.captureException(error, { extra: { context } });
  });

  client.on('ready', () => {
    if (failedAttempts > 0) {
      logger.log(
        `${context} Redis connection recovered after ${failedAttempts} failed attempt(s)`,
      );
    }
    failedAttempts = 0;
  });
}
