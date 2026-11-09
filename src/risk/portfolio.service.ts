import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PortfolioSnapshot } from './engine';
import { executionToDirection } from './risk.mapper';

@Injectable()
export class PortfolioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the current portfolio exposure snapshot from the user's open trades.
   *
   * Each open trade's `execution` (buy/sell) is mapped to the engine's
   * `direction` (long/short) here — the snapshot the engine consumes is purely
   * long/short. `capitalExposure(Pct)` are nullable on trades logged before the
   * risk engine existed; those are treated as 0 exposure.
   */
  async getSnapshot(userId: string): Promise<PortfolioSnapshot> {
    const open = await this.prisma.trade.findMany({
      where: { userId, status: 'open' },
      select: {
        id: true,
        symbol: true,
        execution: true,
        capitalExposure: true,
        capitalExposurePct: true,
      },
    });

    const openTrades = open.map((t) => ({
      tradeId: t.id,
      pair: t.symbol,
      direction: executionToDirection(t.execution),
      exposurePct: t.capitalExposurePct ?? 0,
    }));

    const totalCapitalExposurePct = openTrades.reduce(
      (sum, t) => sum + t.exposurePct,
      0,
    );
    const totalCapitalExposure = open.reduce(
      (sum, t) => sum + (t.capitalExposure ?? 0),
      0,
    );

    return {
      openTradeCount: openTrades.length,
      totalCapitalExposurePct,
      totalCapitalExposure,
      openTrades,
    };
  }
}
