import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuoteService } from './quote.service';
import { FX_MARKET_QUOTE, FX_QUOTE } from './interface/quote.interface';

describe('QuoteService', () => {
  let service: QuoteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuoteService,
        {
          provide: FX_QUOTE,
          useValue: {
            fxRate: jest.fn(),
          },
        },
        {
          provide: FX_MARKET_QUOTE,
          useValue: {
            getMarketQuote: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<QuoteService>(QuoteService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('caches available forex after the first fetch', async () => {
    const getFMPList = jest.spyOn(service, 'getFMPList').mockResolvedValue(
      forexList([
        { symbol: 'EURUSD', fromCurrency: 'EUR', toCurrency: 'USD' },
        { symbol: 'GBPJPY', fromCurrency: 'GBP', toCurrency: 'JPY' },
      ]),
    );

    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
      { symbol: 'GBPJPY', currency: 'JPY' },
    ]);
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
      { symbol: 'GBPJPY', currency: 'JPY' },
    ]);

    expect(getFMPList).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight forex fetch across concurrent callers', async () => {
    const getFMPList = jest
      .spyOn(service, 'getFMPList')
      .mockResolvedValue(
        forexList([
          { symbol: 'EURUSD', fromCurrency: 'EUR', toCurrency: 'USD' },
        ]),
      );

    const [first, second] = await Promise.all([
      service.getAvailableForex(),
      service.getAvailableForex(),
    ]);

    expect(first).toEqual([{ symbol: 'EURUSD', currency: 'USD' }]);
    expect(second).toEqual([{ symbol: 'EURUSD', currency: 'USD' }]);
    expect(getFMPList).toHaveBeenCalledTimes(1);
  });

  it('searches cached forex data', async () => {
    const getFMPList = jest.spyOn(service, 'getFMPList').mockResolvedValue(
      forexList([
        { symbol: 'EURUSD', fromCurrency: 'EUR', toCurrency: 'USD' },
        { symbol: 'GBPJPY', fromCurrency: 'GBP', toCurrency: 'JPY' },
      ]),
    );

    await expect(service.search('jpy')).resolves.toEqual([
      { symbol: 'GBPJPY', currency: 'JPY' },
    ]);
    await expect(service.search('eur')).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
    ]);

    expect(getFMPList).toHaveBeenCalledTimes(1);
  });
});
