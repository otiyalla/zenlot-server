import { QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { BullMqConnectionCloser } from './bullmq-connection.closer';
import {
  createBullMqConnections,
  getBullMqWorkerConnection,
} from './bullmq-connections';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function lazyRedis() {
  // lazyConnect so the test never opens a socket.
  return new Redis({ lazyConnect: true });
}

describe('BullMqConnectionCloser', () => {
  it('quits the shared connection on shutdown', async () => {
    const connection = lazyRedis();
    Object.defineProperty(connection, 'status', { value: 'ready' });
    const quit = jest.spyOn(connection, 'quit').mockResolvedValue('OK');
    const closer = new BullMqConnectionCloser({ connection } as QueueOptions);

    await closer.onApplicationShutdown();

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('quits the attached worker connection too', async () => {
    const connection = createBullMqConnections({
      get: (key: string) => ({ REDIS_HOST: '127.0.0.1', REDIS_PORT: '1' })[key],
    } as unknown as ConfigService);
    const workerConnection = getBullMqWorkerConnection(connection)!;
    try {
      const quitQueue = jest.spyOn(connection, 'quit').mockResolvedValue('OK');
      const quitWorker = jest
        .spyOn(workerConnection, 'quit')
        .mockResolvedValue('OK');
      const closer = new BullMqConnectionCloser({ connection } as QueueOptions);

      await closer.onApplicationShutdown();

      expect(quitQueue).toHaveBeenCalledTimes(1);
      expect(quitWorker).toHaveBeenCalledTimes(1);
    } finally {
      connection.disconnect();
      workerConnection.disconnect();
    }
  });

  it('falls back to disconnect when quit fails', async () => {
    const connection = lazyRedis();
    Object.defineProperty(connection, 'status', { value: 'ready' });
    jest.spyOn(connection, 'quit').mockRejectedValue(new Error('closed'));
    const disconnect = jest
      .spyOn(connection, 'disconnect')
      .mockImplementation(() => undefined);
    const closer = new BullMqConnectionCloser({ connection } as QueueOptions);

    await closer.onApplicationShutdown();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('skips a connection that has already ended', async () => {
    const connection = lazyRedis();
    Object.defineProperty(connection, 'status', { value: 'end' });
    const quit = jest.spyOn(connection, 'quit');
    const closer = new BullMqConnectionCloser({ connection } as QueueOptions);

    await closer.onApplicationShutdown();

    expect(quit).not.toHaveBeenCalled();
  });

  it('ignores plain connection options', async () => {
    const closer = new BullMqConnectionCloser({
      connection: { host: 'localhost', port: 6379 },
    } as QueueOptions);

    await expect(closer.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
