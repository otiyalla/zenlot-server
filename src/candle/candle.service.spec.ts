import { CandleService } from './candle.service';
import { CandleProvider } from './interface/candle.interface';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    isAxiosError: jest.fn(
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        (error as { isAxiosError?: boolean }).isAxiosError === true,
    ),
  },
}));

const HOUR = 60 * 60 * 1000;

type Row = {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

function row(tsMs: number, close = 1.1): Row {
  return {
    ts: new Date(tsMs),
    open: 1,
    high: 2,
    low: 0.5,
    close,
    volume: null,
  };
}

function makePrisma(findManyImpl: jest.Mock) {
  return {
    candle: {
      findMany: findManyImpl,
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function makeProvider(
  source: CandleProvider['source'],
  impl: Partial<CandleProvider> = {},
): jest.Mocked<CandleProvider> {
  return {
    source,
    isConfigured: jest.fn().mockReturnValue(true),
    fetchCandles: jest.fn().mockResolvedValue([]),
    ...impl,
  } as jest.Mocked<CandleProvider>;
}

describe('CandleService', () => {
  const now = 1000 * HOUR;
  beforeAll(() => jest.spyOn(Date, 'now').mockReturnValue(now));
  afterAll(() => jest.restoreAllMocks());

  it('cold cache: fetches from the primary provider, persists, and returns', async () => {
    // First read empty (cold), second read returns the freshly stored bar.
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(500 * HOUR)]);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata', {
      fetchCandles: jest
        .fn()
        .mockResolvedValue([
          { ts: 500 * HOUR, open: 1, high: 2, low: 0.5, close: 1.1 },
        ]),
    });
    const service = new CandleService(prisma as never, [primary]);

    const result = await service.getCandles({
      symbol: 'eur/usd',
      timeframe: 'H1',
      from: 400 * HOUR,
      to: 600 * HOUR,
    });

    expect(primary.fetchCandles).toHaveBeenCalledTimes(1);
    expect(prisma.candle.upsert).toHaveBeenCalledTimes(1);
    expect(result.symbol).toBe('EURUSD');
    expect(result.precision).toBe(5);
    expect(result.candles).toEqual([
      {
        time: (500 * HOUR) / 1000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.1,
        volume: undefined,
      },
    ]);
  });

  it('does not query providers for a live window during the weekend closure', async () => {
    const weekend = Date.UTC(2026, 6, 25, 12);
    (Date.now as jest.Mock)
      .mockReturnValueOnce(weekend)
      .mockReturnValueOnce(weekend);
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata');
    const service = new CandleService(prisma as never, [primary]);

    await expect(service.getLiveBar('EURUSD', 'M15')).resolves.toBeNull();

    expect(primary.fetchCandles).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent fills of the same cold-cache gap', async () => {
    let resolveFetch!: (
      candles: Awaited<ReturnType<CandleProvider['fetchCandles']>>,
    ) => void;
    const fetchResult = new Promise<
      Awaited<ReturnType<CandleProvider['fetchCandles']>>
    >((resolve) => {
      resolveFetch = resolve;
    });
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([row(500 * HOUR)]);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata', {
      fetchCandles: jest.fn().mockReturnValue(fetchResult),
    });
    const service = new CandleService(prisma as never, [primary]);
    const params = {
      symbol: 'EURUSD',
      timeframe: 'H1' as const,
      from: 400 * HOUR,
      to: 600 * HOUR,
    };

    const requests = [service.getCandles(params), service.getCandles(params)];
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(primary.fetchCandles).toHaveBeenCalledTimes(1);

    resolveFetch([{ ts: 500 * HOUR, open: 1, high: 2, low: 0.5, close: 1.1 }]);
    await Promise.all(requests);

    expect(primary.fetchCandles).toHaveBeenCalledTimes(1);
    expect(prisma.candle.upsert).toHaveBeenCalledTimes(1);
  });

  it('warm cache fully covering the window does not call any provider', async () => {
    const existing = [row(500 * HOUR), row(501 * HOUR)];
    const findMany = jest.fn().mockResolvedValue(existing);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata');
    const service = new CandleService(prisma as never, [primary]);

    await service.getCandles({
      symbol: 'EURUSD',
      timeframe: 'H1',
      from: 500 * HOUR,
      to: 501 * HOUR,
    });

    expect(primary.fetchCandles).not.toHaveBeenCalled();
    expect(prisma.candle.upsert).not.toHaveBeenCalled();
  });

  it('rejects windows larger than 300 bars before reading the cache', async () => {
    const findMany = jest.fn();
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata');
    const service = new CandleService(prisma as never, [primary]);

    await expect(
      service.getCandles({
        symbol: 'EURUSD',
        timeframe: 'H1',
        from: 0,
        to: 301 * HOUR,
      }),
    ).rejects.toThrow('Candle window cannot exceed 300 H1 bars');

    expect(findMany).not.toHaveBeenCalled();
    expect(primary.fetchCandles).not.toHaveBeenCalled();
  });

  it('rejects a window inverted by the future end-time cap', async () => {
    const findMany = jest.fn();
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata');
    const service = new CandleService(prisma as never, [primary]);

    await expect(
      service.getCandles({
        symbol: 'EURUSD',
        timeframe: 'H1',
        from: now + 2 * HOUR,
        to: now + 3 * HOUR,
      }),
    ).rejects.toThrow('Candle window start must be earlier than its end');

    expect(findMany).not.toHaveBeenCalled();
    expect(primary.fetchCandles).not.toHaveBeenCalled();
  });

  it('falls back to the next provider when the primary throws', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(500 * HOUR)]);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata', {
      fetchCandles: jest.fn().mockRejectedValue(new Error('429')),
    });
    const backup = makeProvider('oanda', {
      fetchCandles: jest
        .fn()
        .mockResolvedValue([
          { ts: 500 * HOUR, open: 1, high: 2, low: 0.5, close: 1.1 },
        ]),
    });
    const service = new CandleService(prisma as never, [primary, backup]);

    await service.getCandles({
      symbol: 'EURUSD',
      timeframe: 'H1',
      from: 400 * HOUR,
      to: 600 * HOUR,
    });

    expect(primary.fetchCandles).toHaveBeenCalled();
    expect(backup.fetchCandles).toHaveBeenCalled();
  });

  it('falls back to the next provider when the primary returns no candles', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row(500 * HOUR)]);
    const prisma = makePrisma(findMany);
    const primary = makeProvider('twelvedata');
    const backup = makeProvider('oanda', {
      fetchCandles: jest
        .fn()
        .mockResolvedValue([
          { ts: 500 * HOUR, open: 1, high: 2, low: 0.5, close: 1.1 },
        ]),
    });
    const service = new CandleService(prisma as never, [primary, backup]);

    await service.getCandles({
      symbol: 'EURUSD',
      timeframe: 'H1',
      from: 400 * HOUR,
      to: 600 * HOUR,
    });

    expect(primary.fetchCandles).toHaveBeenCalledTimes(1);
    expect(backup.fetchCandles).toHaveBeenCalledTimes(1);
    expect(prisma.candle.upsert).toHaveBeenCalledTimes(1);
  });

  it('uses 3-decimal precision for JPY quote pairs', async () => {
    const findMany = jest.fn().mockResolvedValue([row(500 * HOUR)]);
    const prisma = makePrisma(findMany);
    const service = new CandleService(prisma as never, [
      makeProvider('twelvedata'),
    ]);

    const result = await service.getCandles({
      symbol: 'USDJPY',
      timeframe: 'H1',
      from: 499 * HOUR,
      to: 500 * HOUR,
    });

    expect(result.precision).toBe(3);
  });
});
