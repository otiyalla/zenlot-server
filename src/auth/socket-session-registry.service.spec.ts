import {
  AUTH_VERSION_FLOOR_GRACE_MS,
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
    jest.useFakeTimers();
    registry = new SocketSessionRegistry();
  });

  afterEach(() => {
    registry.onModuleDestroy();
    jest.useRealTimers();
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

  it('expires a floor after the last socket disconnects and the grace window passes', () => {
    const socket = new TestSocket('closed-socket');
    registry.register(socket as never, 'user-1', 4, '/user');
    socket.disconnect(true);

    jest.advanceTimersByTime(AUTH_VERSION_FLOOR_GRACE_MS - 1);
    const staleInsideGrace = new TestSocket('stale-inside-grace');
    expect(
      registry.register(staleInsideGrace as never, 'user-1', 3, '/quote'),
    ).toBe(false);

    jest.advanceTimersByTime(1);
    const socketAfterExpiry = new TestSocket('socket-after-expiry');
    expect(
      registry.register(socketAfterExpiry as never, 'user-1', 3, '/quote'),
    ).toBe(true);
  });

  it('keeps the floor while the user has an active socket', () => {
    const activeSocket = new TestSocket('active-socket');
    registry.register(activeSocket as never, 'user-1', 4, '/candle');

    jest.advanceTimersByTime(AUTH_VERSION_FLOOR_GRACE_MS * 2);
    const staleSocket = new TestSocket('stale-socket');
    expect(
      registry.register(staleSocket as never, 'user-1', 3, '/price-feed'),
    ).toBe(false);
  });

  it('rejects a stale registration during the post-advance grace window', () => {
    registry.advanceAuthVersion('user-1', 4);
    jest.advanceTimersByTime(AUTH_VERSION_FLOOR_GRACE_MS - 1);

    const staleSocket = new TestSocket('late-stale-socket');
    expect(registry.register(staleSocket as never, 'user-1', 3, '/user')).toBe(
      false,
    );
  });

  it('cancels a pending floor expiry when a current socket registers', () => {
    registry.advanceAuthVersion('user-1', 4);
    expect(jest.getTimerCount()).toBe(1);

    const currentSocket = new TestSocket('current-socket');
    expect(
      registry.register(currentSocket as never, 'user-1', 4, '/quote'),
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(AUTH_VERSION_FLOOR_GRACE_MS * 2);
    const staleSocket = new TestSocket('stale-after-original-expiry');
    expect(registry.register(staleSocket as never, 'user-1', 3, '/quote')).toBe(
      false,
    );
  });

  it('does not let an old cleanup callback erase a newer floor', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    registry.advanceAuthVersion('user-1', 4);
    const oldCleanup = setTimeoutSpy.mock.calls[0][0] as () => void;

    registry.advanceAuthVersion('user-1', 5);
    oldCleanup();

    const staleSocket = new TestSocket('stale-after-new-floor');
    expect(
      registry.register(staleSocket as never, 'user-1', 4, '/candle'),
    ).toBe(false);
    setTimeoutSpy.mockRestore();
  });

  it('unrefs cleanup timers and clears them on module destroy', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    registry.advanceAuthVersion('user-1', 4);
    const timer = setTimeoutSpy.mock.results[0].value as NodeJS.Timeout;

    expect(timer.hasRef()).toBe(false);
    expect(jest.getTimerCount()).toBe(1);

    registry.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    setTimeoutSpy.mockRestore();
  });

  it('detaches active socket cleanup listeners on module destroy', () => {
    const socket = new TestSocket('active-at-destroy');
    registry.register(socket as never, 'user-1', 4, '/price-feed');

    registry.onModuleDestroy();

    expect(socket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
  });
});
