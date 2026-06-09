import { AuthService } from '../auth/auth.service';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';

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
      verifyToken: jest.fn().mockResolvedValue({ id: 'user-1' }),
    } satisfies Partial<AuthService>;

    const gateway = new QuoteGateway(
      quoteService as unknown as QuoteService,
      authService as unknown as AuthService,
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
    );
    gateway.server = server as unknown as QuoteGateway['server'];
    const trade = { id: 'trade-1', status: 'reached_tp' };

    gateway.emitTradeClosed('user-1', trade);

    expect(server.to).toHaveBeenCalledWith('user_user-1');
    expect(emit).toHaveBeenCalledWith('trade-closed', trade);
  });
});
