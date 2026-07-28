import {
  AuthenticatedSocketNamespace,
  SocketSessionRegistry,
} from './socket-session-registry.service';

class TestSocket {
  readonly receivedPrivateEvents: string[] = [];
  private readonly disconnectListeners = new Set<() => void>();
  readonly data: Record<string, unknown> = {};
  readonly rooms: Set<string>;
  connected = true;

  constructor(readonly id: string) {
    this.rooms = new Set([id, `private:${id}`]);
  }

  readonly once = jest.fn((event: string, listener: () => void) => {
    if (event === 'disconnect') this.disconnectListeners.add(listener);
    return this;
  });

  readonly off = jest.fn((event: string, listener: () => void) => {
    if (event === 'disconnect') this.disconnectListeners.delete(listener);
    return this;
  });

  readonly disconnect = jest.fn((_close?: boolean) => {
    if (!this.connected) return this;
    this.connected = false;
    for (const listener of [...this.disconnectListeners]) listener();
    return this;
  });

  readonly leave = jest.fn((room: string) => {
    this.rooms.delete(room);
  });

  receivePrivateEvent(event: string): void {
    if (this.connected && !this.data.authSessionRevoked) {
      this.receivedPrivateEvents.push(event);
    }
  }
}

describe('SocketSessionRegistry', () => {
  const namespaces: AuthenticatedSocketNamespace[] = [
    '/user',
    '/quote',
    '/candle',
    '/price-feed',
  ];
  let registry: SocketSessionRegistry;

  beforeEach(() => {
    registry = new SocketSessionRegistry();
  });

  it('disconnects sockets authenticated before reset across every private namespace', () => {
    const staleSockets = namespaces.map(
      (namespace) => new TestSocket(`${namespace}-socket`),
    );
    const unrelatedSocket = new TestSocket('other-user-socket');

    namespaces.forEach((namespace, index) => {
      expect(
        registry.register(staleSockets[index] as never, 'user-1', 3, namespace),
      ).toBe(true);
    });
    registry.register(unrelatedSocket as never, 'user-2', 3, '/quote');

    staleSockets.forEach((socket) =>
      socket.receivePrivateEvent('before-reset'),
    );
    unrelatedSocket.receivePrivateEvent('before-reset');

    expect(registry.advanceAuthVersion('user-1', 4)).toBe(4);

    staleSockets.forEach((socket) => socket.receivePrivateEvent('after-reset'));
    unrelatedSocket.receivePrivateEvent('after-reset');

    for (const socket of staleSockets) {
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.receivedPrivateEvents).toEqual(['before-reset']);
    }
    expect(unrelatedSocket.disconnect).not.toHaveBeenCalled();
    expect(unrelatedSocket.receivedPrivateEvents).toEqual([
      'before-reset',
      'after-reset',
    ]);
  });

  it('disconnects a stale socket that registers after revocation', () => {
    const lateStaleSocket = new TestSocket('late-stale');
    registry.advanceAuthVersion('user-1', 4);

    expect(
      registry.register(lateStaleSocket as never, 'user-1', 3, '/user'),
    ).toBe(false);
    lateStaleSocket.receivePrivateEvent('after-reset');

    expect(lateStaleSocket.disconnect).toHaveBeenCalledWith(true);
    expect(lateStaleSocket.receivedPrivateEvents).toEqual([]);
  });

  it('removes normally disconnected sockets from future revocation work', () => {
    const socket = new TestSocket('closed-socket');
    registry.register(socket as never, 'user-1', 3, '/candle');

    socket.disconnect(true);

    expect(registry.advanceAuthVersion('user-1', 4)).toBe(0);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('immediately retries a stale session when disconnect throws', () => {
    const socket = new TestSocket('retry-socket');
    socket.disconnect.mockImplementationOnce(() => {
      throw new Error('transport failure');
    });
    registry.register(socket as never, 'user-1', 3, '/price-feed');

    expect(registry.advanceAuthVersion('user-1', 4)).toBe(1);
    expect(socket.connected).toBe(false);
    expect(socket.disconnect).toHaveBeenCalledTimes(2);
  });

  it('contains persistent disconnect failure without misreporting reset failure', () => {
    const socket = new TestSocket('failed-socket');
    socket.disconnect.mockImplementation(() => {
      throw new Error('persistent transport failure');
    });
    registry.register(socket as never, 'user-1', 3, '/quote');

    expect(registry.advanceAuthVersion('user-1', 4)).toBe(1);
    expect(socket.connected).toBe(true);
    expect(socket.disconnect).toHaveBeenCalledTimes(2);
    expect(socket.leave).toHaveBeenCalledWith('private:failed-socket');

    socket.receivePrivateEvent('after-reset');
    expect(socket.receivedPrivateEvents).toEqual([]);
  });

  it('contains a transient disconnect failure during late stale registration', () => {
    const socket = new TestSocket('late-retry-socket');
    socket.disconnect.mockImplementationOnce(() => {
      throw new Error('transient transport failure');
    });
    registry.advanceAuthVersion('user-1', 4);

    expect(registry.register(socket as never, 'user-1', 3, '/candle')).toBe(
      false,
    );
    expect(socket.connected).toBe(false);
    expect(socket.disconnect).toHaveBeenCalledTimes(2);
  });
});
