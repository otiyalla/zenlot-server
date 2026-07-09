import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuoteService } from './quote.service';
import { FX_MARKET_QUOTE, FX_QUOTE } from './interface/quote.interface';
import { fmpList } from './dto/quote-list.dto';

const forexList = (items: Partial<fmpList>[]): fmpList[] => items as fmpList[];

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

  it('refetches available forex after the TTL expires', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    const getFMPList = jest
      .spyOn(service, 'getFMPList')
      .mockResolvedValueOnce(
        forexList([
          { symbol: 'EURUSD', fromCurrency: 'EUR', toCurrency: 'USD' },
        ]),
      )
      .mockResolvedValueOnce(
        forexList([
          { symbol: 'GBPJPY', fromCurrency: 'GBP', toCurrency: 'JPY' },
        ]),
      );

    // First call populates the cache at t=0.
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
    ]);

    // Still within the TTL an hour later — served from cache, no new fetch.
    nowSpy.mockReturnValue(60 * 60 * 1000);
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
    ]);
    expect(getFMPList).toHaveBeenCalledTimes(1);

    // Past the 48h TTL — cache is stale, so it refetches the newest list.
    nowSpy.mockReturnValue(48 * 60 * 60 * 1000 + 1);
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'GBPJPY', currency: 'JPY' },
    ]);
    expect(getFMPList).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
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
