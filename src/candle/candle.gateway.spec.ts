import { CandleGateway } from './candle.gateway';
import { CandleLiveService } from './candle-live.service';
import { AuthService } from '../auth/auth.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';

describe('CandleGateway', () => {
  const liveService = {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    getLiveBar: jest.fn(),
  };
  const gateway = new CandleGateway(
    liveService as unknown as CandleLiveService,
    {} as AuthService,
    {} as SocketSessionRegistry,
  );

  beforeEach(() => jest.clearAllMocks());

  it('registers an authenticated candle socket for live revocation', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    const authService = {
      verifyToken: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', authVersion: 3 }),
    };
    const socketSessions = {
      register: jest.fn().mockReturnValue(true),
    };
    const localGateway = new CandleGateway(
      {
        ...liveService,
        registerTickHandler: jest.fn(),
      } as unknown as CandleLiveService,
      authService as unknown as AuthService,
      socketSessions as unknown as SocketSessionRegistry,
    );
    localGateway.server = {
      setMaxListeners: jest.fn(),
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: 'candle-socket',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      on: jest.fn(),
    };

    localGateway.onModuleInit();
    await connectionHandler!(socket);

    expect(socketSessions.register).toHaveBeenCalledWith(
      socket,
      'user-1',
      3,
      '/candle',
    );
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects and rejects subscriptions before authentication completes', async () => {
    const client = {
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
    };

    await gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M5' },
      client as never,
    );

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
    expect(liveService.subscribe).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent subscriptions for the same room', async () => {
    let resolveJoin!: () => void;
    const client = {
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveJoin = resolve;
          }),
      ),
    };
    liveService.getLiveBar.mockResolvedValue(null);

    const first = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    const duplicate = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );

    expect(client.join).toHaveBeenCalledTimes(1);
    expect(liveService.subscribe).toHaveBeenCalledTimes(1);

    resolveJoin();
    await Promise.all([first, duplicate]);
    expect(client.candleRooms.size).toBe(1);
  });

  it('does not emit an initial bar after the client unsubscribes', async () => {
    let resolveBar!: (bar: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }) => void;
    const pendingBar = new Promise<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>((resolve) => {
      resolveBar = resolve;
    });
    const client = {
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn(),
    };
    liveService.getLiveBar.mockReturnValue(pendingBar);

    const subscription = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    await Promise.resolve();

    gateway.handleUnsubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    resolveBar({ time: 1, open: 1, high: 1, low: 1, close: 1 });
    await subscription;

    expect(client.emit).not.toHaveBeenCalledWith(
      'candle:update',
      expect.anything(),
    );
  });

  it('leaves a candle room joined after revocation occurs mid-join', async () => {
    let resolveJoin!: () => void;
    let joinStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      joinStarted = resolve;
    });
    const client = {
      data: {} as Record<string, unknown>,
      disconnected: false,
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveJoin = resolve;
            joinStarted();
          }),
      ),
      leave: jest.fn().mockResolvedValue(undefined),
    };

    const subscription = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    await started;
    client.data.authSessionRevoked = true;
    resolveJoin();
    await subscription;

    expect(client.leave).toHaveBeenCalledWith('EURUSD:M15');
    expect(liveService.unsubscribe).toHaveBeenCalledWith('EURUSD', 'M15');
    expect(liveService.getLiveBar).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('does not emit an initial bar when revocation occurs during lookup', async () => {
    let resolveBar!: (bar: {
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }) => void;
    const client = {
      data: {} as Record<string, unknown>,
      disconnected: false,
      user: { id: 'user-1' },
      candleRooms: new Map(),
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn(),
    };
    liveService.getLiveBar.mockReturnValue(
      new Promise((resolve) => {
        resolveBar = resolve;
      }),
    );

    const subscription = gateway.handleSubscribe(
      { symbol: 'EURUSD', timeframe: 'M15' },
      client as never,
    );
    await Promise.resolve();
    client.data.authSessionRevoked = true;
    resolveBar({ time: 1, open: 1, high: 1, low: 1, close: 1 });
    await subscription;

    expect(client.emit).not.toHaveBeenCalledWith(
      'candle:update',
      expect.anything(),
    );
  });

  it('disconnects and rejects unsubscriptions before authentication completes', () => {
    const client = {
      disconnect: jest.fn(),
      leave: jest.fn(),
    };

    gateway.handleUnsubscribe(
      { symbol: 'EURUSD', timeframe: 'M5' },
      client as never,
    );

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.leave).not.toHaveBeenCalled();
    expect(liveService.unsubscribe).not.toHaveBeenCalled();
  });
});
