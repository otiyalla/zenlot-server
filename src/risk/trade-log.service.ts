import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, trade } from '../../prisma/generated/prisma/client';
import { RiskCalculationService } from './risk-calculation.service';
import { RateResolverService } from './rate-resolver.service';
import { DrawdownService } from './drawdown.service';
import { RiskProfileService } from './risk-profile.service';
import { calculatePnL, calculateRMultiple } from './engine';
import { executionToDirection } from './risk.mapper';
import { LogTradeDto } from './dto/log-trade.dto';
import {
  COACHING_QUEUE,
  CoachingJobData,
  GENERATE_COACHING_JOB,
} from './coaching/coaching.processor';

/**
 * Trade statuses whose close settled realized PnL onto the account balance +
 * drawdown (i.e. called {@link DrawdownService.settleRealizedPnL}). Manual close
 * sets `closed_in_profit`/`closed_in_loss`; the auto-close job sets
 * `reached_tp`/`reached_sl`. The neutral `'closed'` status (legacy update path)
 * is intentionally absent — it never settles PnL.
 */
const SETTLED_STATUSES = new Set<string>([
  'closed_in_profit',
  'closed_in_loss',
  'reached_tp',
  'reached_sl',
]);

@Injectable()
export class TradeLogService {
  private readonly logger = new Logger(TradeLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskCalculationService: RiskCalculationService,
    private readonly rateResolver: RateResolverService,
    private readonly drawdownService: DrawdownService,
    private readonly riskProfileService: RiskProfileService,
    @InjectQueue(COACHING_QUEUE) private readonly coachingQueue: Queue,
  ) {}

  /**
   * Logs a trade as open after re-sizing it and re-running governance server-side
   * (client numbers are never trusted).
   *
   * This is a journal, not an execution platform — the trade has (or will be)
   * placed on the broker regardless, so a blocking rule never stops the log. When
   * a trade breaks a rule we instead return a structured 422 the client turns into
   * an override dialog; the user acknowledges and re-submits, and we persist the
   * trade flagged `overridden` with the acknowledgement recorded on the governance
   * log so rule-breaking is tracked rather than hidden. The only hard stop is a
   * position that sizes to zero (we have nothing to record).
   */
  async logTrade(
    userId: string,
    accountCurrency: string,
    dto: LogTradeDto,
    language: string = 'en',
  ): Promise<trade> {
    const { calculation, governance } =
      await this.riskCalculationService.calculate(
        userId,
        accountCurrency,
        dto,
        language,
      );

    if (calculation.lotSizeRounded <= 0) {
      throw new BadRequestException(
        'Position size rounds to zero — increase your account balance or tighten the stop.',
      );
    }

    // Rules that, in isolation, would have blocked this trade. Informational
    // checks (e.g. the per-trade sizing target) never gate and are excluded.
    const blockingChecks = governance.checks.filter(
      (c) => !c.informational && c.status === 'blocked',
    );
    const blockedRuleKeys = blockingChecks.map((c) => c.rule);

    let overridden = false;
    if (governance.overallStatus === 'blocked') {
      const profile = await this.riskProfileService.getProfile(
        userId,
        accountCurrency,
      );
      const acknowledgedRules = dto.acknowledgedRules ?? [];
      // In 'detailed' mode the user must tick every blocking rule; in 'simple'
      // mode a single confirmation covers them all.
      const acknowledged =
        profile.overrideMode === 'detailed'
          ? blockedRuleKeys.every((rule) => acknowledgedRules.includes(rule))
          : dto.acknowledged === true;

      if (!acknowledged) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          error: 'GovernanceBlocked',
          requiresAcknowledgement: true,
          overrideMode: profile.overrideMode,
          blockedReason:
            governance.blockedReason ??
            'This trade breaks one or more of your risk rules.',
          message:
            governance.blockedReason ??
            'This trade breaks one or more of your risk rules.',
          checks: blockingChecks,
        });
      }
      overridden = true;
    }

    const rewardValue =
      calculation.rewardPips !== null && calculation.rewardToRisk !== null
        ? calculation.actualCapitalExposure * calculation.rewardToRisk
        : 0;

    const created = await this.prisma.trade.create({
      data: {
        userId,
        symbol: calculation.symbol,
        entry: calculation.entry,
        lot: calculation.lotSizeRounded,
        pips: calculation.pipSize,
        execution: calculation.execution,
        accountCurrency,
        exchangeRate: calculation.exchangeRate,
        rr: calculation.rewardToRisk ?? 0,
        risk: calculation.actualCapitalExposure,
        reward: rewardValue,
        stopLoss: {
          value: calculation.stopPrice,
          pips: calculation.stopDistancePips,
        },
        takeProfit: {
          value: calculation.targetPrice ?? 0,
          pips: calculation.rewardPips ?? 0,
        },
        status: 'open',
        capitalExposure: calculation.actualCapitalExposure,
        capitalExposurePct: calculation.capitalExposurePct,
        governanceStatus: governance.overallStatus,
        overridden,
        plainText: dto.plainText ?? null,
        editorState: dto.editorState ?? null,
      },
    });

    const log = await this.prisma.governanceLog.create({
      data: {
        userId,
        tradeId: created.id,
        overallStatus: governance.overallStatus,
        checksJson: JSON.parse(
          JSON.stringify(governance.checks),
        ) as Prisma.InputJsonValue,
        blockedReason: governance.blockedReason,
        acknowledged: overridden,
        // Record which blocking rules were overridden (all of them, since an
        // override requires acknowledging every blocking rule).
        acknowledgedRules: overridden ? blockedRuleKeys : [],
        overrideReason: overridden ? (dto.overrideReason ?? null) : null,
      },
    });

    // Fire async AI coaching (non-blocking — failure must not fail the log).
    try {
      const jobData: CoachingJobData = {
        governanceLogId: log.id,
        tradeId: created.id,
        userId,
        language,
        accountCurrency,
        calculation,
        governance,
      };
      await this.coachingQueue.add(GENERATE_COACHING_JOB, jobData, {
        removeOnComplete: true,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue coaching job', error as Error);
      Sentry.captureException(error, {
        extra: {
          tradeId: created.id,
          context: 'TradeLogService.logTrade.enqueue',
        },
      });
    }

    return created;
  }

  /**
   * Closes an open trade: computes PnL + R-multiple, then atomically updates the
   * trade, the account balance (auto-update path, spec §11.2), and the drawdown
   * state (which may trip a circuit breaker).
   */
  async closeTrade(
    userId: string,
    tradeId: string,
    exitPrice: number,
  ): Promise<trade> {
    const existing = await this.prisma.trade.findUnique({
      where: { id: tradeId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Trade not found');
    }
    if (existing.status !== 'open') {
      throw new BadRequestException('Trade is not open');
    }

    const direction = executionToDirection(existing.execution);
    const stopPrice = Number(
      (existing.stopLoss as unknown as { value: number }).value,
    );
    const closeExchangeRate = await this.rateResolver.resolveExchangeRate(
      existing.symbol,
      existing.accountCurrency,
    );

    const pnl = calculatePnL({
      symbol: existing.symbol,
      entryPrice: existing.entry,
      exitPrice,
      lotSize: existing.lot,
      direction,
      exchangeRate: closeExchangeRate,
    });
    const rMultiple = calculateRMultiple(
      existing.entry,
      exitPrice,
      stopPrice,
      direction,
    );
    const status = pnl >= 0 ? 'closed_in_profit' : 'closed_in_loss';

    // Ensure a risk profile row exists so the balance increment below succeeds.
    await this.riskProfileService.getProfile(userId, existing.accountCurrency);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.trade.update({
        where: { id: tradeId },
        data: {
          closedPrice: exitPrice,
          closedExchangeRate: closeExchangeRate,
          pnl,
          rMultiple,
          status,
          closedAt: new Date(),
          closedReason: 'manual',
        },
      });

      // Increment balance + recompute drawdown atomically with the close.
      await this.drawdownService.settleRealizedPnL(tx, userId, pnl);

      return updated;
    });
  }

  /**
   * Deletes a trade and, when that trade had already settled realized PnL onto
   * the account, reverses that settlement atomically so the circuit
   * breaker/drawdown state reflects reality.
   *
   * Only trades closed through a PnL-settling path are reversed. Those are the
   * statuses that called {@link DrawdownService.settleRealizedPnL}: the manual
   * close (`closed_in_profit`/`closed_in_loss`) and the auto-close job
   * (`reached_tp`/`reached_sl`). Open trades and the neutral `'closed'` status
   * (set via the legacy update path, which never settles PnL) carry no realized
   * PnL, so they are deleted without touching balance/drawdown — exposure and
   * open-trade-count auto-update from the live open-trade snapshot.
   *
   * Reversal is the inverse of `settleRealizedPnL`: decrement
   * `riskProfile.accountBalance` by `pnl` and recompute drawdown via
   * `applyBalanceDelta(tx, userId, -pnl)`. Reversing a null/0 PnL is a safe
   * no-op. Note sticky breach flags are not un-tripped here (they clear only on
   * the period reset) — only the balance and drawdown percentages are
   * recomputed.
   */
  async deleteTrade(
    userId: string,
    tradeId: string,
  ): Promise<{ deleted: true }> {
    const existing = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Trade not found');
    }

    // Round to the same 2dp precision settleRealizedPnL used when it applied the
    // PnL, so the reversal is the exact inverse (the stored trade.pnl is the raw,
    // unrounded calculatePnL output; settlement incremented the rounded value).
    const reversePnl =
      SETTLED_STATUSES.has(existing.status) && existing.pnl
        ? Math.round((existing.pnl + Number.EPSILON) * 100) / 100
        : 0;

    await this.prisma.$transaction(async (tx) => {
      await tx.trade.delete({ where: { id: tradeId } });

      if (reversePnl !== 0) {
        // Mirror settleRealizedPnL's profile gate: settlement is a no-op when the
        // user has no risk profile (e.g. an auto-closed trade whose settlement was
        // skipped because no profile existed). With no settlement to undo, there
        // is nothing to reverse — and `riskProfile.update` would throw P2025 on a
        // missing row, failing the whole delete.
        const profile = await tx.riskProfile.findUnique({ where: { userId } });
        if (profile) {
          // Inverse of settleRealizedPnL: undo the balance increment and recompute
          // drawdown against the rolled-back balance.
          await this.drawdownService.applyBalanceDelta(tx, userId, -reversePnl);
          await tx.riskProfile.update({
            where: { userId },
            data: {
              accountBalance: { decrement: reversePnl },
              lastBalanceSource: 'trade_close',
              lastBalanceSetAt: new Date(),
            },
          });
        }
      }
    });

    return { deleted: true };
  }
}
