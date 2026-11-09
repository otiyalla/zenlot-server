import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, tradingPlan } from '../../prisma/generated/prisma/client';
import {
  TradingPlan,
  TradingPlanEntryConditions,
  TradingPlanExitRules,
  TradingPlanSessionRules,
  TradingPlanStopRules,
} from './engine';
import { UpsertTradingPlanDto } from './dto/upsert-trading-plan.dto';

/**
 * Persistence + mapping for the trader's strategy contract (spec Section 3).
 *
 * Plan adherence is always graded against the CURRENT version. Saving a plan
 * never mutates history: it flips the previous current row to isCurrent=false
 * and inserts a new version row — both in one transaction so the partial-unique
 * index (`tradingPlan_userId_current_key`, only one isCurrent=true per user)
 * is never momentarily violated.
 */
@Injectable()
export class TradingPlanService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's current plan as the engine's domain shape, or null. */
  async getCurrentPlan(userId: string): Promise<TradingPlan | null> {
    const row = await this.prisma.tradingPlan.findFirst({
      where: { userId, isCurrent: true },
      orderBy: { version: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  /**
   * Saves a new plan version. Marks the previous current plan not-current and
   * inserts the next version atomically.
   */
  async savePlan(
    userId: string,
    dto: UpsertTradingPlanDto,
  ): Promise<TradingPlan> {
    const created = await this.prisma.$transaction(async (tx) => {
      const previous = await tx.tradingPlan.findFirst({
        where: { userId, isCurrent: true },
        orderBy: { version: 'desc' },
      });

      // Flip the previous current plan FIRST so the partial-unique index allows
      // the new isCurrent=true row in the same transaction.
      if (previous) {
        await tx.tradingPlan.update({
          where: { id: previous.id },
          data: { isCurrent: false },
        });
      }

      return tx.tradingPlan.create({
        data: {
          userId,
          version: (previous?.version ?? 0) + 1,
          isCurrent: true,
          entryConditions:
            dto.entryConditions as unknown as Prisma.InputJsonValue,
          stopRules: dto.stopRules as unknown as Prisma.InputJsonValue,
          exitRules: dto.exitRules as unknown as Prisma.InputJsonValue,
          sessionRules: dto.sessionRules as unknown as Prisma.InputJsonValue,
        },
      });
    });

    return this.toDomain(created);
  }

  /** Maps a persisted tradingPlan row to the engine's TradingPlan interface. */
  private toDomain(row: tradingPlan): TradingPlan {
    return {
      userId: row.userId,
      version: row.version,
      updatedAt: row.createdAt.toISOString(),
      entryConditions:
        row.entryConditions as unknown as TradingPlanEntryConditions,
      stopRules: row.stopRules as unknown as TradingPlanStopRules,
      exitRules: row.exitRules as unknown as TradingPlanExitRules,
      sessionRules: row.sessionRules as unknown as TradingPlanSessionRules,
    };
  }
}
