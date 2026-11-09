import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteGateway } from '../quote/quote.gateway';
import { QuoteService } from '../quote/quote.service';
import { DrawdownService } from '../risk/drawdown.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PostTradeGradingService } from '../evaluation/post-trade-grading.service';
import {
  SCAN_OPEN_TRADES_JOB,
  TRADE_SCAN_INTERVAL_MS,
  TradeAutoCloseService,
} from './trade-auto-close.service';

type OpenTradeFixture = {
  id: string;
  userId: string;
  symbol: string;
  execution: string;
  entry: number;
  lot: number;
  accountCurrency: string;
  exchangeRate: number;
  stopLoss: { value: number; pips: number };
  takeProfit: { value: number; pips: number };
};

type TradeUpdateArg = {
  where: { id: string; status: string };
  data: {
    closedAt: Date;
    closedExchangeRate: number;
    closedPrice: number;
    closedReason: string;
    isAutoClosed: boolean;
    status: string;
    pnl: number;
    rMultiple: number | null;
  };
};

describe('TradeAutoCloseService', () => {
  const openTrade: OpenTradeFixture = {
    id: 'trade-1',
    userId: 'user-1',
    symbol: 'EURUSD',
    execution: 'buy',
    entry: 1.1,
    lot: 0.2,
    accountCurrency: 'USD',
    exchangeRate: 1.1,
    stopLoss: { value: 1.09, pips: 10 },
    takeProfit: { value: 1.11, pips: 10 },
  };

  const createSubject = (trades: OpenTradeFixture[] = [openTrade]) => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      trade: {
        findMany: jest.fn().mockResolvedValue(trades),
        // updateMany runs inside $transaction; expose the same mock on prisma
        // so existing assertions on prisma.trade.updateMany keep working.
        updateMany,
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...trades[0], status: 'reached_tp' }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({
          trade: { updateMany },
          // The auto-close path snapshots breach flags before/after settlement
          // to detect newly tripped circuit breakers for a drawdown push.
          drawdownState: {
            findUnique: jest.fn().mockResolvedValue({
              dailyBreached: false,
              weeklyBreached: false,
              monthlyBreached: false,
            }),
          },
        }),
      ),
    };
    const quoteService = {
      fxRate: jest.fn(),
    };
    const gateway = {
      emitTradeClosed: jest.fn(),
    };
    const drawdown = {
      settleRealizedPnL: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      notifyTradeClosed: jest.fn().mockResolvedValue(undefined),
      notifyDrawdownBreach: jest.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: jest.fn(),
    };
    const postTradeGrading = {
      gradeClosedTrade: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TradeAutoCloseService(
      prisma as unknown as PrismaService,
      quoteService as unknown as QuoteService,
      gateway as unknown as QuoteGateway,
      drawdown as unknown as DrawdownService,
      notifications as unknown as NotificationsService,
      postTradeGrading as unknown as PostTradeGradingService,
      queue as unknown as Queue,
    );

    return {
      drawdown,
      gateway,
      notifications,
      postTradeGrading,
      prisma,
      queue,
      quoteService,
      service,
    };
  };

  const getLastUpdateArg = (updateMany: jest.Mock): TradeUpdateArg => {
    const calls = updateMany.mock.calls as Array<[TradeUpdateArg]>;
    const call = calls.at(-1)?.[0];
    if (!call) {
      throw new Error('updateMany was not called');
    }
    return call;
  };

  it('registers one five-minute scan job at initialization', async () => {
    const { queue, service } = createSubject();

    await service.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      SCAN_OPEN_TRADES_JOB,
      {},
      {
        jobId: SCAN_OPEN_TRADES_JOB,
        repeat: { every: TRADE_SCAN_INTERVAL_MS },
      },
    );
  });

  it.each([
    ['buy', 1.11, 'reached_tp', 'take_profit', 1.11],
    ['buy', 1.12, 'reached_tp', 'take_profit', 1.11],
    ['buy', 1.09, 'reached_sl', 'stop_loss', 1.09],
    ['buy', 1.08, 'reached_sl', 'stop_loss', 1.09],
    ['sell', 1.09, 'reached_tp', 'take_profit', 1.09],
    ['sell', 1.08, 'reached_tp', 'take_profit', 1.09],
    ['sell', 1.11, 'reached_sl', 'stop_loss', 1.11],
    ['sell', 1.12, 'reached_sl', 'stop_loss', 1.11],
  ])(
    'closes a %s trade at its configured boundary for observed price %s',
    async (execution, observedPrice, status, reason, closedPrice) => {
      const levels: OpenTradeFixture =
        execution === 'buy'
          ? openTrade
          : {
              ...openTrade,
              execution: 'sell',
              stopLoss: { value: 1.11, pips: 10 },
              takeProfit: { value: 1.09, pips: 10 },
            };
      const { gateway, prisma, quoteService, service } = createSubject([
        levels,
      ]);
      quoteService.fxRate.mockResolvedValue({ price: observedPrice });

      await service.scanOpenTrades();

      const updateArg = getLastUpdateArg(prisma.trade.updateMany);
      expect(updateArg.where).toEqual({ id: 'trade-1', status: 'open' });
      expect(updateArg.data.closedAt).toBeInstanceOf(Date);
      expect(updateArg.data.closedExchangeRate).toBe(1);
      expect(updateArg.data.closedPrice).toBe(closedPrice);
      expect(updateArg.data.closedReason).toBe(reason);
      expect(updateArg.data.isAutoClosed).toBe(true);
      expect(updateArg.data.status).toBe(status);
      expect(gateway.emitTradeClosed).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ id: 'trade-1', status: 'reached_tp' }),
      );
    },
  );

  it('records PnL/R-multiple and settles balance + drawdown on close', async () => {
    const { drawdown, prisma, quoteService, service } = createSubject();
    quoteService.fxRate.mockResolvedValue({ price: 1.11 }); // buy TP hit

    await service.scanOpenTrades();

    const data = getLastUpdateArg(prisma.trade.updateMany).data;
    // entry 1.10 → exit 1.11, lot 0.2, forex contract 100000, rate 1 → +200
    expect(data.pnl).toBeCloseTo(200, 6);
    // R = (1.11-1.10)/(1.10-1.09) = 1
    expect(data.rMultiple).toBeCloseTo(1, 6);
    expect(drawdown.settleRealizedPnL).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.closeTo(200, 6),
    );
  });

  it.each([
    ['buy', 1.105, 1.12, 1.104],
    ['sell', 1.095, 1.08, 1.096],
  ] as const)(
    'auto-closes a %s profit-lock stop with positive PnL',
    async (execution, stopPrice, targetPrice, observedPrice) => {
      const { prisma, quoteService, service } = createSubject([
        {
          ...openTrade,
          execution,
          stopLoss: { value: stopPrice, pips: 50 },
          takeProfit: { value: targetPrice, pips: 200 },
        },
      ]);
      quoteService.fxRate.mockResolvedValue({ price: observedPrice });

      await service.scanOpenTrades();

      const data = getLastUpdateArg(prisma.trade.updateMany).data;
      expect(data.closedPrice).toBe(stopPrice);
      expect(data.closedReason).toBe('stop_loss');
      expect(data.status).toBe('reached_sl');
      expect(data.pnl).toBeCloseTo(100, 6);
      // R currently uses the active stop as its denominator.
      expect(data.rMultiple).toBeCloseTo(1, 6);
    },
  );

  it('requests a symbol quote once in entry orientation and leaves untriggered trades open', async () => {
    const secondTrade = { ...openTrade, id: 'trade-2' };
    const { prisma, quoteService, service } = createSubject([
      openTrade,
      secondTrade,
    ]);
    quoteService.fxRate.mockResolvedValue({ price: 1.1 });

    await service.scanOpenTrades();

    expect(quoteService.fxRate).toHaveBeenCalledTimes(1);
    expect(quoteService.fxRate).toHaveBeenCalledWith({
      base: 'EUR',
      quote: 'USD',
    });
    expect(prisma.trade.updateMany).not.toHaveBeenCalled();
  });

  it('skips trades with malformed levels or unsupported executions', async () => {
    const { prisma, quoteService, service } = createSubject([
      {
        ...openTrade,
        id: 'bad-level',
        stopLoss: { value: 'bad', pips: 0 },
      } as unknown as OpenTradeFixture,
      { ...openTrade, id: 'bad-side', execution: 'limit' },
    ]);

    await service.scanOpenTrades();

    expect(quoteService.fxRate).not.toHaveBeenCalled();
    expect(prisma.trade.updateMany).not.toHaveBeenCalled();
  });

  it('does not retrieve or emit when another worker already closed the trade', async () => {
    const { gateway, prisma, quoteService, service } = createSubject();
    quoteService.fxRate.mockResolvedValue({ price: 1.11 });
    prisma.trade.updateMany.mockResolvedValue({ count: 0 });

    await service.scanOpenTrades();

    expect(prisma.trade.findUnique).not.toHaveBeenCalled();
    expect(gateway.emitTradeClosed).not.toHaveBeenCalled();
  });

  it('stores the current closing exchange rate when one is available', async () => {
    const { prisma, quoteService, service } = createSubject([
      { ...openTrade, accountCurrency: 'CAD' },
    ]);
    quoteService.fxRate
      .mockResolvedValueOnce({ price: 1.11 })
      .mockResolvedValueOnce({ price: 1.37 });

    await service.scanOpenTrades();

    expect(quoteService.fxRate).toHaveBeenNthCalledWith(2, {
      base: 'USD',
      quote: 'CAD',
    });
    expect(
      getLastUpdateArg(prisma.trade.updateMany).data.closedExchangeRate,
    ).toBe(1.37);
  });

  it('retains the stored entry exchange rate if close-time conversion fails', async () => {
    const { prisma, quoteService, service } = createSubject([
      { ...openTrade, accountCurrency: 'CAD', exchangeRate: 1.31 },
    ]);
    quoteService.fxRate
      .mockResolvedValueOnce({ price: 1.11 })
      .mockRejectedValueOnce(new Error('provider unavailable'));

    await service.scanOpenTrades();

    expect(
      getLastUpdateArg(prisma.trade.updateMany).data.closedExchangeRate,
    ).toBe(1.31);
  });
});
