import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import Redis from 'ioredis';
import { buildRedisOptions, reportRedisErrors } from './redis.config';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function configWith(values: Record<string, string | undefined>) {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

function silentLogger() {
  return {
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  } as unknown as Logger & {
    error: jest.Mock;
    debug: jest.Mock;
    log: jest.Mock;
  };
}

describe('redis config', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('buildRedisOptions', () => {
    it('maps host, port and credentials without TLS by default', () => {
      const options = buildRedisOptions(
        configWith({
          REDIS_HOST: 'redis.example.com',
          REDIS_PORT: '12345',
          REDIS_USERNAME: 'default',
          REDIS_PASSWORD: 'secret',
        }),
      );

      expect(options).toEqual({
        host: 'redis.example.com',
        port: 12345,
        username: 'default',
        password: 'secret',
      });
    });

    it('defaults the port to 6379', () => {
      expect(buildRedisOptions(configWith({})).port).toBe(6379);
    });

    it('enables TLS with SNI and verification when REDIS_TLS is truthy', () => {
      const options = buildRedisOptions(
        configWith({ REDIS_HOST: 'redis.example.com', REDIS_TLS: 'TRUE' }),
      );

      expect(options.tls).toEqual({
        servername: 'redis.example.com',
        rejectUnauthorized: true,
      });
    });

    it('allows disabling certificate verification', () => {
      const options = buildRedisOptions(
        configWith({
          REDIS_HOST: 'redis.example.com',
          REDIS_TLS: 'yes',
          REDIS_TLS_REJECT_UNAUTHORIZED: 'false',
        }),
      );

      expect(options.tls).toEqual({
        servername: 'redis.example.com',
        rejectUnauthorized: false,
      });
    });
  });

  describe('reportRedisErrors', () => {
    it('reports only the first error of an outage to Sentry', () => {
      const client = new EventEmitter();
      const logger = silentLogger();
      reportRedisErrors(client as unknown as Redis, logger, 'Test.client');

      const refused = new Error('ERR max number of clients reached');
      client.emit('error', refused);
      client.emit('error', refused);
      client.emit('error', refused);

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(refused, {
        extra: { context: 'Test.client' },
      });
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('reports again after the client recovers and fails anew', () => {
      const client = new EventEmitter();
      const logger = silentLogger();
      reportRedisErrors(client as unknown as Redis, logger, 'Test.client');

      client.emit('error', new Error('first outage'));
      client.emit('error', new Error('first outage'));
      client.emit('ready');
      client.emit('error', new Error('second outage'));

      expect(Sentry.captureException).toHaveBeenCalledTimes(2);
      expect(logger.log).toHaveBeenCalledWith(
        'Test.client Redis connection recovered after 2 failed attempt(s)',
      );
    });

    it('does not log recovery on the first successful connect', () => {
      const client = new EventEmitter();
      const logger = silentLogger();
      reportRedisErrors(client as unknown as Redis, logger, 'Test.client');

      client.emit('ready');

      expect(logger.log).not.toHaveBeenCalled();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });
});
