import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QuoteGateway } from '../quote/quote.gateway';
import { QuoteService } from '../quote/quote.service';
import { DrawdownService } from '../risk/drawdown.service';
import { calculatePnL, calculateRMultiple } from '../risk/engine';
import { executionToDirection } from '../risk/risk.mapper';

export const TRADE_AUTO_CLOSE_QUEUE = 'trade-auto-close';
export const SCAN_OPEN_TRADES_JOB = 'scan-open-trades';
export const TRADE_SCAN_INTERVAL_MS = 300000;

type Execution = 'buy' | 'sell';
type CloseReason = 'take_profit' | 'stop_loss';
type ClosedStatus = 'reached_tp' | 'reached_sl';

interface StoredTrade {
  id: string;
  userId: string;
  symbol: string;
  execution: string;
  entry: number;
  lot: number;
  accountCurrency: string;
  exchangeRate: number;
  stopLoss: unknown;
  takeProfit: unknown;
}

interface MonitoredTrade extends StoredTrade {
  symbol: string;
  execution: Execution;
  stopLossValue: number;
  takeProfitValue: number;
}

interface Trigger {
  price: number;
  reason: CloseReason;
  status: ClosedStatus;
}

@Injectable()
export class TradeAutoCloseService implements OnModuleInit {
  private readonly logger = new Logger(TradeAutoCloseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteService: QuoteService,
    private readonly quoteGateway: QuoteGateway,
    private readonly drawdownService: DrawdownService,
    @InjectQueue(TRADE_AUTO_CLOSE_QUEUE)
    private readonly autoCloseQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.autoCloseQueue.add(
      SCAN_OPEN_TRADES_JOB,
      {},
      {
        jobId: SCAN_OPEN_TRADES_JOB,
        repeat: { every: TRADE_SCAN_INTERVAL_MS },
      },
    );
  }

  async scanOpenTrades(): Promise<void> {
    const openTrades = (await this.prisma.trade.findMany({
      where: { status: 'open' },
    })) as StoredTrade[];
    const tradesBySymbol = new Map<string, MonitoredTrade[]>();

    for (const trade of openTrades) {
      const monitoredTrade = this.toMonitoredTrade(trade);
      if (!monitoredTrade) {
        continue;
      }

      const trades = tradesBySymbol.get(monitoredTrade.symbol) ?? [];
      trades.push(monitoredTrade);
      tradesBySymbol.set(monitoredTrade.symbol, trades);
    }

    for (const [symbol, trades] of tradesBySymbol.entries()) {
      let price: number;
      try {
        const result = await this.quoteService.fxRate({
          base: symbol.substring(0, 3),
          quote: symbol.substring(3, 6),
        });
        price = result.price;
        if (!Number.isFinite(price)) {
          throw new Error(`Invalid price returned for ${symbol}`);
        }
      } catch (error) {
        this.logger.error(
          `Unable to evaluate open trades for ${symbol}`,
          error,
        );
        Sentry.captureException(error, {
          extra: { symbol, context: 'TradeAutoCloseService.symbolQuote' },
        });
        continue;
      }

      for (const trade of trades) {
        const trigger = this.getTrigger(trade, price);
        if (trigger) {
          await this.closeTriggeredTrade(trade, trigger);
        }
      }
    }
  }

  private toMonitoredTrade(trade: StoredTrade): MonitoredTrade | null {
    const symbol = trade.symbol?.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(symbol)) {
      this.logger.warn(`Skipping trade ${trade.id}: invalid symbol`);
      return null;
    }

    const execution = trade.execution?.toLowerCase();
    if (execution !== 'buy' && execution !== 'sell') {
      this.logger.warn(`Skipping trade ${trade.id}: invalid execution`);
      return null;
    }

    const stopLossValue = this.readLevel(trade.stopLoss);
    const takeProfitValue = this.readLevel(trade.takeProfit);
    if (stopLossValue === null || takeProfitValue === null) {
      this.logger.warn(`Skipping trade ${trade.id}: invalid TP/SL level`);
      return null;
    }

    return {
      ...trade,
      symbol,
      execution,
      stopLossValue,
      takeProfitValue,
    };
  }

  private readLevel(level: unknown): number | null {
    if (
      typeof level !== 'object' ||
      level === null ||
      !('value' in level) ||
      typeof level.value !== 'number' ||
      !Number.isFinite(level.value)
    ) {
      return null;
    }
    return level.value;
  }

  private getTrigger(trade: MonitoredTrade, price: number): Trigger | null {
    if (trade.execution === 'buy') {
      if (price >= trade.takeProfitValue) {
        return {
          price: trade.takeProfitValue,
          reason: 'take_profit',
          status: 'reached_tp',
        };
      }
      if (price <= trade.stopLossValue) {
        return {
          price: trade.stopLossValue,
          reason: 'stop_loss',
          status: 'reached_sl',
        };
      }
      return null;
    }

    if (price <= trade.takeProfitValue) {
      return {
        price: trade.takeProfitValue,
        reason: 'take_profit',
        status: 'reached_tp',
      };
    }
    if (price >= trade.stopLossValue) {
      return {
        price: trade.stopLossValue,
        reason: 'stop_loss',
        status: 'reached_sl',
      };
    }
    return null;
  }
  private async closeTriggeredTrade(
    trade: MonitoredTrade,
    trigger: Trigger,
  ): Promise<void> {
    const closedExchangeRate = await this.getClosedExchangeRate(trade);
    const direction = executionToDirection(trade.execution);
    const pnl = calculatePnL({
      symbol: trade.symbol,
      entryPrice: trade.entry,
      exitPrice: trigger.price,
      lotSize: trade.lot,
      direction,
      exchangeRate: closedExchangeRate,
    });
    // calculateRMultiple throws when entry === stop; tolerate that in the job.
    const rMultiple =
      trade.entry !== trade.stopLossValue
        ? calculateRMultiple(
            trade.entry,
            trigger.price,
            trade.stopLossValue,
            direction,
          )
        : null;

    const settled = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.trade.updateMany({
        where: { id: trade.id, status: 'open' },
        data: {
          closedAt: new Date(),
          closedPrice: trigger.price,
          closedReason: trigger.reason,
          closedExchangeRate,
          isAutoClosed: true,
          status: trigger.status,
          pnl,
          rMultiple,
        },
      });
      if (count === 0) {
        return false;
      }
      // Reflect the realized PnL on the account balance + drawdown (no-op if the
      // user has no risk profile). Atomic with the trade close.
      await this.drawdownService.settleRealizedPnL(tx, trade.userId, pnl);
      return true;
    });

    if (!settled) {
      return;
    }

    const updatedTrade = await this.prisma.trade.findUnique({
      where: { id: trade.id },
    });
    if (!updatedTrade) {
      this.logger.warn(
        `Closed trade ${trade.id} no longer exists for notification`,
      );
      return;
    }

    this.quoteGateway.emitTradeClosed(trade.userId, updatedTrade);
  }

  private async getClosedExchangeRate(trade: MonitoredTrade): Promise<number> {
    const quoteCurrency = trade.symbol.substring(3, 6);
    const accountCurrency = trade.accountCurrency?.trim().toUpperCase();
    if (quoteCurrency === accountCurrency) {
      return 1;
    }

    try {
      const { price } = await this.quoteService.fxRate({
        base: quoteCurrency,
        quote: accountCurrency,
      });
      if (!Number.isFinite(price)) {
        throw new Error('Invalid closing exchange rate returned');
      }
      return price;
    } catch (error) {
      this.logger.warn(
        `Unable to fetch closing exchange rate for trade ${trade.id}; using entry rate`,
      );
      Sentry.captureException(error, {
        extra: {
          tradeId: trade.id,
          context: 'TradeAutoCloseService.exchangeRate',
        },
      });
      return trade.exchangeRate;
    }
  }
}
