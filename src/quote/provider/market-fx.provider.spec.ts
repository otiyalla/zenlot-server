import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MarketFxClient } from './market-fx.provider';
import { ProviderBudget } from '../../candle/util/provider-budget';

const mockRequest = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => mockRequest),
    isAxiosError: jest.fn(
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        (error as { isAxiosError?: boolean }).isAxiosError === true,
    ),
  },
}));

describe('MarketFxClient', () => {
  let client: MarketFxClient;
  const providerBudget = {
    canUse: jest.fn().mockReturnValue(true),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };

  const createModule = (apiKey?: string) =>
    Test.createTestingModule({
      providers: [
        MarketFxClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'TWELVEDATA_API_KEY' ? apiKey : undefined,
            ),
          },
        },
        { provide: ProviderBudget, useValue: providerBudget },
      ],
    }).compile();

  beforeEach(async () => {
    jest.clearAllMocks();
    providerBudget.canUse.mockReturnValue(true);
    const module: TestingModule = await createModule('test-api-key');
    client = module.get(MarketFxClient);
  });

  describe('fxRate', () => {
    it('requests /price with BASE/QUOTE symbol and parses price', async () => {
      mockRequest.mockResolvedValue({ data: { price: '1.23456' } });

      const result = await client.fxRate({ base: 'EUR', quote: 'USD' });

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/price',
        params: { symbol: 'EUR/USD', apikey: 'test-api-key' },
      });
      expect(result).toEqual({ price: 1.23456 });
      expect(providerBudget.recordSuccess).toHaveBeenCalledWith('twelvedata');
    });

    it('throws when API returns error payload', async () => {
      mockRequest.mockResolvedValue({
        data: { status: 'error', code: 401, message: 'Invalid apikey' },
      });

      await expect(
        client.fxRate({ base: 'GBP', quote: 'USD' }),
      ).rejects.toThrow('Invalid apikey');
      expect(providerBudget.recordFailure).toHaveBeenCalledWith(
        'twelvedata',
        false,
      );
    });
  });

  describe('getMarketQuote', () => {
    it('requests /quote and maps snapshot fields', async () => {
      mockRequest.mockResolvedValue({
        data: {
          symbol: 'GBP/USD',
          name: 'British Pound / US Dollar',
          open: '1.25000',
          high: '1.26000',
          low: '1.24000',
          close: '1.25500',
          percent_change: '0.40',
          is_market_open: true,
        },
      });

      const result = await client.getMarketQuote({ base: 'GBP', quote: 'USD' });

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/quote',
        params: { symbol: 'GBP/USD', apikey: 'test-api-key' },
      });
      expect(result).toMatchObject({
        symbol: 'GBP/USD',
        name: 'British Pound / US Dollar',
        open: 1.25,
        high: 1.26,
        low: 1.24,
        close: 1.255,
        price: 1.255,
        percentChange: 0.4,
        isMarketOpen: true,
      });
      expect(providerBudget.recordSuccess).toHaveBeenCalledWith('twelvedata');
    });

    it('does not call TwelveData when the shared budget is unavailable', async () => {
      providerBudget.canUse.mockReturnValue(false);

      await expect(
        client.getMarketQuote({ base: 'EUR', quote: 'USD' }),
      ).rejects.toThrow('TwelveData request budget is temporarily unavailable');
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('missing api key', () => {
    beforeEach(async () => {
      const module = await createModule(undefined);
      client = module.get(MarketFxClient);
    });

    it('throws when fxRate is called without configured key', async () => {
      await expect(
        client.fxRate({ base: 'EUR', quote: 'USD' }),
      ).rejects.toThrow('market fx client is not initialized');
    });

    it('throws when getMarketQuote is called without configured key', async () => {
      await expect(
        client.getMarketQuote({ base: 'EUR', quote: 'USD' }),
      ).rejects.toThrow('market fx client is not initialized');
    });
  });
});
