import { Test, TestingModule } from '@nestjs/testing';
import { Socket } from 'socket.io';
import { QuoteGateway } from './quote.gateway';
import { QuoteService } from './quote.service';
import { AuthService } from '../auth/auth.service';

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
              accessToken: ' header-token ',
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
});
