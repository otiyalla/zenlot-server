import { QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { BullMqConnectionCloser } from './bullmq-connection.closer';

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
