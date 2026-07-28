import { AuthService } from '../auth/auth.service';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';

type TestSocket = {
  id: string;
  handshake: {
    auth: { accessToken: string };
    headers: Record<string, unknown>;
  };
  disconnect: jest.Mock;
  join: jest.Mock;
  leave: jest.Mock;
  on: jest.Mock;
};

type ConnectionHandler = (socket: TestSocket) => Promise<void>;
type DisconnectHandler = () => void;

describe('QuoteGateway room mapping', () => {
  it('joins and leaves room using authenticated user id', async () => {
    let connectionHandler: ConnectionHandler | undefined;
    let disconnectHandler: DisconnectHandler | undefined;

    const server = {
      setMaxListeners: jest.fn(),
      on: jest.fn((event: string, handler: ConnectionHandler) => {
        if (event === 'connection') {
          connectionHandler = handler;
        }
      }),
    };

    const quoteService = {
      getAvailableForex: jest.fn(),
      fxRate: jest.fn(),
    } satisfies Partial<QuoteService>;
    const authService = {
      verifyToken: jest
        .fn()
        .mockResolvedValue({ id: 'user-1', authVersion: 3 }),
    } satisfies Partial<AuthService>;
    const socketSessions = {
      register: jest.fn().mockReturnValue(true),
    } satisfies Partial<SocketSessionRegistry>;

    const gateway = new QuoteGateway(
      quoteService as unknown as QuoteService,
      authService as unknown as AuthService,
      socketSessions as unknown as SocketSessionRegistry,
    );
    gateway.server = server as unknown as QuoteGateway['server'];

    gateway.onModuleInit();
    expect(connectionHandler).toBeDefined();

    const socket: TestSocket = {
      id: 'socket-1',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      on: jest.fn((event: string, handler: DisconnectHandler) => {
        if (event === 'disconnect') {
          disconnectHandler = handler;
        }
      }),
    };

    await connectionHandler!(socket);
    expect(socketSessions.register).toHaveBeenCalledWith(
      socket,
      'user-1',
      3,
      '/quote',
    );
    expect(socket.join).toHaveBeenCalledWith('user_user-1');

    disconnectHandler!();
    expect(socket.leave).toHaveBeenCalledWith('user_user-1');
  });

  it('emits a closed trade only to the owner room', () => {
    const emit = jest.fn();
    const server = {
      to: jest.fn().mockReturnValue({ emit }),
    };
    const gateway = new QuoteGateway(
      {} as unknown as QuoteService,
      {} as unknown as AuthService,
      {} as unknown as SocketSessionRegistry,
    );
    gateway.server = server as unknown as QuoteGateway['server'];
    const trade = { id: 'trade-1', status: 'reached_tp' };

    gateway.emitTradeClosed('user-1', trade);

    expect(server.to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith('trade-closed', trade);
  });

  it('disconnects a registered socket when its user-room join fails', async () => {
    let connectionHandler: ConnectionHandler | undefined;
    const server = {
      setMaxListeners: jest.fn(),
      on: jest.fn((event: string, handler: ConnectionHandler) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    };
    const socketSessions = {
      register: jest.fn().mockReturnValue(true),
    };
    const gateway = new QuoteGateway(
      {} as unknown as QuoteService,
      {
        verifyToken: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', authVersion: 3 }),
      } as unknown as AuthService,
      socketSessions as unknown as SocketSessionRegistry,
    );
    gateway.server = server as unknown as QuoteGateway['server'];
    gateway.onModuleInit();
    const socket: TestSocket = {
      id: 'failed-join-socket',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn().mockRejectedValue(new Error('adapter unavailable')),
      leave: jest.fn(),
      on: jest.fn(),
    };

    await connectionHandler!(socket);

    expect(socketSessions.register).toHaveBeenCalledWith(
      socket,
      'user-1',
      3,
      '/quote',
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('leaves a room joined after the session was revoked mid-join', async () => {
    let connectionHandler: ConnectionHandler | undefined;
    let resolveJoin!: () => void;
    let joinStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      joinStarted = resolve;
    });
    const gateway = new QuoteGateway(
      {} as unknown as QuoteService,
      {
        verifyToken: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', authVersion: 3 }),
      } as unknown as AuthService,
      {
        register: jest.fn().mockReturnValue(true),
      } as unknown as SocketSessionRegistry,
    );
    gateway.server = {
      setMaxListeners: jest.fn(),
      on: jest.fn((event: string, handler: ConnectionHandler) => {
        if (event === 'connection') connectionHandler = handler;
      }),
    } as unknown as QuoteGateway['server'];
    gateway.onModuleInit();
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

    const connection = connectionHandler!(socket as unknown as TestSocket);
    await started;
    socket.data.authSessionRevoked = true;
    resolveJoin();
    await connection;

    expect(socket.leave).toHaveBeenCalledWith('user_user-1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
