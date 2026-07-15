import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FmpClient } from './fmp.provider';

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

describe('FmpClient', () => {
  let client: FmpClient;

  const createModule = (apiKey?: string) =>
    Test.createTestingModule({
      providers: [
        FmpClient,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'FMP_API_KEY' ? apiKey : undefined,
            ),
          },
        },
      ],
    }).compile();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await createModule('test-api-key');
    client = module.get(FmpClient);
  });

  describe('fxRate', () => {
    it('requests /quote-short with BASEQUOTE symbol and parses price', async () => {
      mockRequest.mockResolvedValue({
        data: [{ symbol: 'EURUSD', price: '1.23456' }],
      });

      const result = await client.fxRate({ base: 'EUR', quote: 'USD' });

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/quote-short',
        params: { symbol: 'EURUSD', apikey: 'test-api-key' },
      });
      expect(result).toEqual({ price: 1.23456 });
    });

    it('throws when price is missing from response', async () => {
      mockRequest.mockResolvedValue({
        data: [{ symbol: 'GBPUSD' }],
      });

      await expect(
        client.fxRate({ base: 'GBP', quote: 'USD' }),
      ).rejects.toThrow('Price not found in FMP response for GBPUSD');
    });

    it('parses stringified symbol payloads', async () => {
      mockRequest.mockResolvedValue({
        data: [{ symbol: 'USDJPY', price: 150.12 }],
      });

      const result = await client.fxRate(
        JSON.stringify({ base: 'USD', quote: 'JPY' }),
      );

      expect(mockRequest).toHaveBeenCalledWith({
        url: '/quote-short',
        params: { symbol: 'USDJPY', apikey: 'test-api-key' },
      });
      expect(result).toEqual({ price: 150.12 });
    });
  });

  describe('missing api key', () => {
    beforeEach(async () => {
      const module = await createModule(undefined);
      client = module.get(FmpClient);
    });

    it('throws when fxRate is called without configured key', async () => {
      await expect(
        client.fxRate({ base: 'EUR', quote: 'USD' }),
      ).rejects.toThrow('fmp client is not initialized');
    });
  });
});
