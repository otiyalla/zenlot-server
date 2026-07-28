import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QuoteService } from './quote.service';
import { FX_MARKET_QUOTE, FX_QUOTE } from './interface/quote.interface';
import { fmpList } from './dto/quote-list.dto';

const forexList = (items: Partial<fmpList>[]): fmpList[] => items as fmpList[];

describe('QuoteService', () => {
  let service: QuoteService;
  let fxQuote: { fxRate: jest.Mock };

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
    fxQuote = module.get<{ fxRate: jest.Mock }>(FX_QUOTE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('caches cachedFxRate for the TTL and de-dupes upstream calls', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    fxQuote.fxRate
      .mockResolvedValueOnce({ price: 1.2345 })
      .mockResolvedValueOnce({ price: 1.9999 });

    // First resolution hits the provider and caches the result.
    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).resolves.toEqual({ price: 1.2345 });

    // Still within the 5-minute TTL — served from cache, no new upstream call.
    nowSpy.mockReturnValue(4 * 60 * 1000);
    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).resolves.toEqual({ price: 1.2345 });
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(1);

    // Past the TTL — cache is stale, so it re-resolves from the provider.
    nowSpy.mockReturnValue(5 * 60 * 1000 + 1);
    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).resolves.toEqual({ price: 1.9999 });
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('shares one in-flight cachedFxRate fetch across concurrent callers', async () => {
    fxQuote.fxRate.mockResolvedValue({ price: 1.5 });

    const [first, second] = await Promise.all([
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ]);

    expect(first).toEqual({ price: 1.5 });
    expect(second).toEqual({ price: 1.5 });
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(1);
  });

  it('serves one stale cachedFxRate to concurrent callers when refresh fails', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    fxQuote.fxRate.mockResolvedValueOnce({ price: 1.25 });

    await service.cachedFxRate({ base: 'USD', quote: 'EUR' });

    nowSpy.mockReturnValue(5 * 60 * 1000 + 1);
    let rejectRefresh!: (error: Error) => void;
    fxQuote.fxRate.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
    );

    const first = service.cachedFxRate({ base: 'USD', quote: 'EUR' });
    const second = service.cachedFxRate({ base: 'USD', quote: 'EUR' });
    rejectRefresh(new Error('provider unavailable'));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { price: 1.25 },
      { price: 1.25 },
    ]);
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(2);

    // A failed refresh gets a short retry backoff without changing the
    // original successful-fetch timestamp.
    nowSpy.mockReturnValue(5 * 60 * 1000 + 30 * 1000);
    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).resolves.toEqual({ price: 1.25 });
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(2);

    // Once the retry window expires, a later attempt can recover.
    nowSpy.mockReturnValue(6 * 60 * 1000 + 2);
    fxQuote.fxRate.mockResolvedValueOnce({ price: 1.3 });
    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).resolves.toEqual({ price: 1.3 });
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(3);

    nowSpy.mockRestore();
  });

  it('rejects a provider failure once the cached rate exceeds its maximum age', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    fxQuote.fxRate.mockResolvedValueOnce({ price: 1.25 });
    await service.cachedFxRate({ base: 'USD', quote: 'EUR' });

    nowSpy.mockReturnValue(60 * 60 * 1000 + 1);
    fxQuote.fxRate.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).rejects.toThrow('provider unavailable');
    expect(fxQuote.fxRate).toHaveBeenCalledTimes(2);

    nowSpy.mockRestore();
  });

  it('propagates cachedFxRate failures when no cached rate exists', async () => {
    fxQuote.fxRate.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      service.cachedFxRate({ base: 'USD', quote: 'EUR' }),
    ).rejects.toThrow('provider unavailable');
  });

  it('does not cache fxRate — the entry-quote path always re-fetches', async () => {
    fxQuote.fxRate.mockResolvedValue({ price: 1.5 });

    await service.fxRate({ base: 'EUR', quote: 'USD' });
    await service.fxRate({ base: 'EUR', quote: 'USD' });

    expect(fxQuote.fxRate).toHaveBeenCalledTimes(2);
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

  it('backs off refreshes after serving stale forex data', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
    const getFMPList = jest
      .spyOn(service, 'getFMPList')
      .mockResolvedValueOnce(
        forexList([
          { symbol: 'EURUSD', fromCurrency: 'EUR', toCurrency: 'USD' },
        ]),
      )
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(
        forexList([
          { symbol: 'GBPJPY', fromCurrency: 'GBP', toCurrency: 'JPY' },
        ]),
      );

    await service.getAvailableForex();

    const expiredAt = 48 * 60 * 60 * 1000 + 1;
    nowSpy.mockReturnValue(expiredAt);
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'EURUSD', currency: 'USD' },
    ]);

    nowSpy.mockReturnValue(expiredAt + 30 * 1000);
    await service.search('eur');
    expect(getFMPList).toHaveBeenCalledTimes(2);

    nowSpy.mockReturnValue(expiredAt + 60 * 1000);
    await expect(service.getAvailableForex()).resolves.toEqual([
      { symbol: 'GBPJPY', currency: 'JPY' },
    ]);
    expect(getFMPList).toHaveBeenCalledTimes(3);

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
