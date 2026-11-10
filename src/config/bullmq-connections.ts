import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Processor, RedisConnection, Worker, WorkerOptions } from 'bullmq';
import Redis from 'ioredis';
import { buildRedisOptions, reportRedisErrors } from './redis.config';

/**
 * BullMQ connections shared across the app.
 *
 * Without sharing, each Queue opens its own connection and each Worker opens
 * two, which added up to more than the 30 connections the Redis Cloud plan
 * allows (Sentry NODE-NESTJS-2N). With sharing, the app uses one connection
 * for all queues, one for all workers, and one blocking connection per worker
 * (BullMQ always duplicates the worker connection for that).
 *
 * Queues and workers need different retry settings, so they can't share one:
 * - Workers: BullMQ requires maxRetriesPerRequest: null, so commands wait for
 *   Redis to come back instead of failing.
 * - Queues: request handlers await queue.add() (for example
 *   TradeLogService.logTrade), so commands must fail during an outage rather
 *   than wait forever. 20 retries (the ioredis default) rejects pending
 *   commands after about 10 seconds.
 */

const WORKER_CONNECTION = Symbol('zenlot.bullmq.workerConnection');

type QueueConnection = Redis & { [WORKER_CONNECTION]?: Redis };

/**
 * Creates the queue connection, with the worker connection attached to it.
 * Pass the result as `connection` in BullModule.forRootAsync; queues use it
 * directly and SharedConnectionWorker swaps in the attached worker connection.
 */
export function createBullMqConnections(config: ConfigService): Redis {
  const options = buildRedisOptions(config);

  const queueConnection: QueueConnection = new Redis({
    ...options,
    connectionName: 'zenlot:bullmq-queues',
    maxRetriesPerRequest: 20,
  });
  const workerConnection = new Redis({
    ...options,
    connectionName: 'zenlot:bullmq-workers',
    maxRetriesPerRequest: null,
  });

  const logger = new Logger('BullMQConnections');
  reportRedisErrors(queueConnection, logger, 'BullMQ.queues');
  reportRedisErrors(workerConnection, logger, 'BullMQ.workers');

  queueConnection[WORKER_CONNECTION] = workerConnection;
  return queueConnection;
}

/** The worker connection attached by createBullMqConnections, if any. */
export function getBullMqWorkerConnection(
  connection: unknown,
): Redis | undefined {
  if (!(connection instanceof Redis)) return undefined;
  return (connection as QueueConnection)[WORKER_CONNECTION];
}

/**
 * Worker options with the queue connection replaced by its attached worker
 * connection. Options without an attached worker connection are unchanged.
 */
export function withWorkerConnection(
  opts?: WorkerOptions,
): WorkerOptions | undefined {
  const workerConnection = getBullMqWorkerConnection(opts?.connection);
  return workerConnection ? { ...opts, connection: workerConnection } : opts;
}

/**
 * Worker that runs on the shared worker connection. Registered with
 * `BullModule.workerClass`, so every @Processor gets it; @nestjs/bullmq would
 * otherwise hand workers the queue connection.
 */
export class SharedConnectionWorker extends Worker {
  constructor(
    name: string,
    processor?: string | URL | null | Processor,
    opts?: WorkerOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(name, processor, withWorkerConnection(opts), Connection);
  }
}
