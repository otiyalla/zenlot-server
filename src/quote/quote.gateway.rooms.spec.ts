import { QuoteGateway } from './quote.gateway';

describe('QuoteGateway room mapping', () => {
  it('joins and leaves room using authenticated user id', async () => {
    let connectionHandler: ((socket: any) => Promise<void>) | undefined;
    let disconnectHandler: (() => void) | undefined;

    const server = {
      setMaxListeners: jest.fn(),
      on: jest.fn((event: string, handler: any) => {
        if (event === 'connection') {
          connectionHandler = handler;
        }
      }),
    };

    const quoteService = {
      getAvailableForex: jest.fn(),
      fxRate: jest.fn(),
    };
    const authService = {
      verifyToken: jest.fn().mockResolvedValue({ id: 'user-1' }),
    };

    const gateway = new QuoteGateway(quoteService as any, authService as any);
    (gateway as any).server = server;

    gateway.onModuleInit();
    expect(connectionHandler).toBeDefined();

    const socket = {
      id: 'socket-1',
      handshake: { auth: { accessToken: 'token' }, headers: {} },
      disconnect: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      on: jest.fn((event: string, handler: any) => {
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
});
