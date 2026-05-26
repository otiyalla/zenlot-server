import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteGateway } from '../quote/quote.gateway';
import { QuoteService } from '../quote/quote.service';
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
  };
};

describe('TradeAutoCloseService', () => {
  const openTrade: OpenTradeFixture = {
    id: 'trade-1',
    userId: 'user-1',
    symbol: 'EURUSD',
    execution: 'buy',
    accountCurrency: 'USD',
    exchangeRate: 1.1,
    stopLoss: { value: 1.09, pips: 10 },
    takeProfit: { value: 1.11, pips: 10 },
  };

  const createSubject = (trades: OpenTradeFixture[] = [openTrade]) => {
    const prisma = {
      trade: {
        findMany: jest.fn().mockResolvedValue(trades),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...trades[0], status: 'reached_tp' }),
      },
    };
    const quoteService = {
      fxRate: jest.fn(),
    };
    const gateway = {
      emitTradeClosed: jest.fn(),
    };
    const queue = {
      add: jest.fn(),
    };
    const service = new TradeAutoCloseService(
      prisma as unknown as PrismaService,
      quoteService as unknown as QuoteService,
      gateway as unknown as QuoteGateway,
      queue as unknown as Queue,
    );

    return { gateway, prisma, queue, quoteService, service };
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
