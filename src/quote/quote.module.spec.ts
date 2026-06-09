import { ConfigService } from '@nestjs/config';
import { MarketFxClient } from './provider/market-fx.provider';
import { UniRateClient } from './provider/unirate.provider';

describe('QuoteModule FX_QUOTE factory', () => {
  const marketFxClient = { fxRate: jest.fn() };
  const uniRateClient = { fxRate: jest.fn() };

  const createFxQuote = (config: Record<string, string | undefined>) => {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;

    const factory = (
      cs: ConfigService,
      market: MarketFxClient,
      uniRate: UniRateClient,
    ) => {
      const hasMarketFx = !!cs.get<string>('TWELVEDATA_API_KEY');
      const hasUniRate = !!cs.get<string>('UNIRATE_API_KEY');

      return {
        async fxRate(symbols: { base: string; quote: string }) {
          if (hasMarketFx) {
            try {
              return await market.fxRate(symbols);
            } catch {
              if (!hasUniRate) {
                throw new Error('market fx failed');
              }
            }
          }

          if (hasUniRate) {
            return uniRate.fxRate(symbols);
          }

          throw new Error('No provider');
        },
      };
    };

    return factory(
      configService,
      marketFxClient as unknown as MarketFxClient,
      uniRateClient as unknown as UniRateClient,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses MarketFx first when both keys are configured', async () => {
    marketFxClient.fxRate.mockResolvedValue({ price: 1.1 });
    const fxQuote = createFxQuote({
      TWELVEDATA_API_KEY: 'primary',
      UNIRATE_API_KEY: 'backup',
    });

    const result = await fxQuote.fxRate({ base: 'EUR', quote: 'USD' });

    expect(marketFxClient.fxRate).toHaveBeenCalled();
    expect(uniRateClient.fxRate).not.toHaveBeenCalled();
    expect(result).toEqual({ price: 1.1 });
  });

  it('falls back to UniRate when MarketFx fails', async () => {
    marketFxClient.fxRate.mockRejectedValue(new Error('upstream error'));
    uniRateClient.fxRate.mockResolvedValue({ price: 2.2 });
    const fxQuote = createFxQuote({
      TWELVEDATA_API_KEY: 'primary',
      UNIRATE_API_KEY: 'backup',
    });

    const result = await fxQuote.fxRate({ base: 'EUR', quote: 'USD' });

    expect(marketFxClient.fxRate).toHaveBeenCalled();
    expect(uniRateClient.fxRate).toHaveBeenCalled();
    expect(result).toEqual({ price: 2.2 });
  });
});
