import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  createBullMqConnections,
  getBullMqWorkerConnection,
  withWorkerConnection,
} from './bullmq-connections';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const config = {
  // Nothing listens on port 1; each test disconnects straight away.
  get: (key: string): string | undefined =>
    ({ REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' })[key],
} as unknown as ConfigService;

describe('BullMQ shared connections', () => {
  let queueConnection: Redis;
  let workerConnection: Redis | undefined;

  beforeAll(() => {
    // Keep the expected ECONNREFUSED noise out of the test output.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    queueConnection = createBullMqConnections(config);
    workerConnection = getBullMqWorkerConnection(queueConnection);
  });

  afterEach(() => {
    queueConnection.disconnect();
    workerConnection?.disconnect();
  });

  it('gives queues a bounded connection so queue.add() fails during an outage', () => {
    expect(queueConnection).toBeInstanceOf(Redis);
    expect(queueConnection.options.maxRetriesPerRequest).toBe(20);
    expect(queueConnection.options.connectionName).toBe('zenlot:bullmq-queues');
  });

  it('attaches a separate worker connection with unlimited retries', () => {
    expect(workerConnection).toBeInstanceOf(Redis);
    expect(workerConnection).not.toBe(queueConnection);
    expect(workerConnection?.options.maxRetriesPerRequest).toBeNull();
    expect(workerConnection?.options.connectionName).toBe(
      'zenlot:bullmq-workers',
    );
  });

  it('finds no worker connection on other connections', () => {
    expect(getBullMqWorkerConnection(undefined)).toBeUndefined();
    expect(
      getBullMqWorkerConnection({ host: 'localhost', port: 6379 }),
    ).toBeUndefined();
  });

  it('gives workers the attached worker connection', () => {
    const opts = withWorkerConnection({
      connection: queueConnection,
      concurrency: 2,
    });

    expect(opts?.connection).toBe(workerConnection);
    expect(opts?.concurrency).toBe(2);
  });

  it('leaves worker options alone when no worker connection is attached', () => {
    const opts = { connection: { host: 'localhost', port: 6379 } };

    expect(withWorkerConnection(opts)).toBe(opts);
    expect(withWorkerConnection(undefined)).toBeUndefined();
  });
});
