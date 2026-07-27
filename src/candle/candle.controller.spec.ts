import { APP_GUARD } from '@nestjs/core';
import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '../auth/auth.guard';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { CandleController } from './candle.controller';
import { CandleService } from './candle.service';

jest.mock('./dto/candle-query.dto', () => ({
  CandleQueryDto: class CandleQueryDto {},
}));

describe('CandleController authentication', () => {
  let app: NestFastifyApplication;
  let authService: { verify: jest.Mock };
  let candleService: { getCandles: jest.Mock };

  beforeAll(async () => {
    authService = {
      verify: jest.fn().mockResolvedValue({ id: 'user-id' }),
    };
    candleService = {
      getCandles: jest.fn().mockResolvedValue({
        symbol: 'EURUSD',
        timeframe: 'H1',
        source: 'cache',
        candles: [],
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CandleController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: CandleService,
          useValue: candleService,
        },
        {
          provide: APP_GUARD,
          useClass: AuthGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('uses AuthGuard as the application-wide guard', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: APP_GUARD,
          useClass: AuthGuard,
        }),
      ]),
    );
  });

  it('rejects GET /candle without access or refresh tokens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/candle?symbol=EURUSD&timeframe=H1',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      message: 'No tokens provided',
      statusCode: 401,
    });
    expect(authService.verify).not.toHaveBeenCalled();
    expect(candleService.getCandles).not.toHaveBeenCalled();
  });

  it('allows GET /candle with a valid access token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/candle?symbol=EURUSD&timeframe=H1',
      headers: {
        accesstoken: 'valid-access-token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authService.verify).toHaveBeenCalledWith('valid-access-token', '');
    expect(candleService.getCandles).toHaveBeenCalledWith({
      symbol: 'EURUSD',
      timeframe: 'H1',
      from: undefined,
      to: undefined,
    });
  });
});
