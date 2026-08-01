import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';
import { AuthService } from '../auth/auth.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';

describe('QuoteGateway', () => {
  let gateway: QuoteGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteGateway,
        {
          provide: QuoteService,
          useValue: {},
        },
        {
          provide: AuthService,
          useValue: {},
        },
        {
          provide: SocketSessionRegistry,
          useValue: { register: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get<QuoteGateway>(QuoteGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('extractAccessToken', () => {
    const extractAccessToken = (socket: Partial<Socket>) =>
      (
        gateway as unknown as {
          extractAccessToken(socket: Partial<Socket>): string | undefined;
        }
      ).extractAccessToken(socket);

    it('falls back to accessToken header when auth payload is missing', () => {
      expect(
        extractAccessToken({
          handshake: {
            headers: {
              accesstoken: ' header-token ',
            },
          } as unknown as Socket['handshake'],
        }),
      ).toBe('header-token');
    });

    it('falls back to authorization bearer header when auth payload is missing', () => {
      expect(
        extractAccessToken({
          handshake: {
            headers: {
              authorization: 'Bearer bearer-token',
            },
          } as unknown as Socket['handshake'],
        }),
      ).toBe('bearer-token');
    });
  });

  it('does not emit a quote response when revocation happens during lookup', async () => {
    let resolveQuotes!: (quotes: string[]) => void;
    const quoteService = (
      gateway as unknown as { quoteService: { getAvailableForex: jest.Mock } }
    ).quoteService;
    quoteService.getAvailableForex = jest.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveQuotes = resolve;
        }),
    );
    const client = {
      data: {} as Record<string, unknown>,
      emit: jest.fn(),
    };

    const response = gateway.handleEvent(client as unknown as Socket);
    client.data.authSessionRevoked = true;
    resolveQuotes(['EURUSD']);
    await response;

    expect(client.emit).not.toHaveBeenCalled();
  });
});
