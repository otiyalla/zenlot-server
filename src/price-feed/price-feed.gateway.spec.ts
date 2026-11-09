import { Test, TestingModule } from '@nestjs/testing';
import { PriceFeedGateway } from './price-feed.gateway';
import { AuthService } from '../auth/auth.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';

describe('PriceFeedGateway', () => {
  let gateway: PriceFeedGateway;
  let authService: { verifyToken: jest.Mock };
  let socketSessions: { register: jest.Mock };

  beforeEach(async () => {
    authService = {
      verifyToken: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', authVersion: 3 }),
    };
    socketSessions = { register: jest.fn().mockReturnValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceFeedGateway,
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: SocketSessionRegistry,
          useValue: socketSessions,
        },
      ],
    }).compile();

    gateway = module.get<PriceFeedGateway>(PriceFeedGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('registers an authenticated price-feed socket for live revocation', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    gateway.server = {
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: 'price-feed-socket',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
      on: jest.fn(),
    };

    gateway.onModuleInit();
    await connectionHandler!(socket);

    expect(socketSessions.register).toHaveBeenCalledWith(
      socket,
      'user-1',
      3,
      '/price-feed',
    );
    expect(socket.join).toHaveBeenCalledWith('user_user-1');
  });

  it.each([
    [
      'a lowercased custom header',
      { accesstoken: 'header-token' },
      'header-token',
    ],
    [
      'a Bearer authorization header',
      { authorization: '  Bearer bearer-token  ' },
      'bearer-token',
    ],
  ])('authenticates with %s', async (_label, headers, expectedToken) => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    gateway.server = {
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: `header-${expectedToken}`,
      handshake: { auth: {}, headers },
      disconnect: jest.fn(),
      join: jest.fn(),
      on: jest.fn(),
    };

    gateway.onModuleInit();
    await connectionHandler!(socket);

    expect(authService.verifyToken).toHaveBeenCalledWith(expectedToken);
    expect(socketSessions.register).toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('rejects malformed authorization headers', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    gateway.server = {
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: 'malformed-header',
      handshake: { auth: {}, headers: { authorization: 'Basic credentials' } },
      disconnect: jest.fn(),
      join: jest.fn(),
      on: jest.fn(),
    };

    gateway.onModuleInit();
    await connectionHandler!(socket);

    expect(authService.verifyToken).not.toHaveBeenCalled();
    expect(socketSessions.register).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnects a registered socket when its user-room join fails', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    gateway.server = {
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: 'failed-join-socket',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockRejectedValue(new Error('adapter unavailable')),
      on: jest.fn(),
    };

    gateway.onModuleInit();
    await connectionHandler!(socket);

    expect(socketSessions.register).toHaveBeenCalledWith(
      socket,
      'user-1',
      3,
      '/price-feed',
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('leaves a room joined after the session was revoked mid-join', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    let resolveJoin!: () => void;
    let joinStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      joinStarted = resolve;
    });
    gateway.server = {
      on: jest.fn((event: string, handler: (socket: any) => Promise<void>) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as never;
    const socket = {
      id: 'mid-join-revoked',
      data: {} as Record<string, unknown>,
      disconnected: false,
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveJoin = resolve;
            joinStarted();
          }),
      ),
      leave: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    gateway.onModuleInit();
    const connection = connectionHandler!(socket);
    await started;
    socket.data.authSessionRevoked = true;
    resolveJoin();
    await connection;

    expect(socket.leave).toHaveBeenCalledWith('user_user-1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
