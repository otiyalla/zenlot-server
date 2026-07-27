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
import { NotificationsService } from '../notifications/notifications.service';
import { DrawdownPeriod } from '../notifications/notification.copy';
import { EvaluationService } from '../evaluation/evaluation.service';
import { PostTradeGradingService } from '../evaluation/post-trade-grading.service';
import { StopAdjustment } from '../evaluation/engine';

/**
 * Trade statuses whose close settled realized PnL onto the account balance +
 * drawdown (i.e. called {@link DrawdownService#settleRealizedPnL}). Manual close
 * sets `closed_in_profit`/`closed_in_loss`; the auto-close job sets
 * `reached_tp`/`reached_sl`. The neutral `'closed'` status (legacy update path)
 * is intentionally absent — it never settles PnL.
 */
export const SETTLED_STATUSES = new Set<string>([
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
    private readonly notifications: NotificationsService,
    private readonly evaluationService: EvaluationService,
    private readonly postTradeGrading: PostTradeGradingService,
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

    // Phase 2 soft-gate (decision #2 — warn, never block). If the client passed
    // a pre-trade checklistId, link that checklist + its evaluation to this
    // trade; otherwise record that the checklist was SKIPPED (a behavioral
    // signal that maps to EvaluatedTrade.checklistSkipped). Best-effort: a
    // failure here must never fail the trade log.
    try {
      if (dto.checklistId) {
        const linked = await this.evaluationService.linkChecklistToTrade(
          userId,
          created.id,
          dto.checklistId,
        );
        if (!linked) {
          // The supplied checklist was not linkable (unknown / not owned /
          // already bound) — treat the trade as having skipped its checklist.
          await this.evaluationService.markChecklistSkipped(userId, created.id);
        }
      } else {
        await this.evaluationService.markChecklistSkipped(userId, created.id);
      }
    } catch (error) {
      this.logger.error(
        'Failed to wire pre-trade checklist soft-gate',
        error as Error,
      );
      Sentry.captureException(error, {
        extra: {
          tradeId: created.id,
          context: 'TradeLogService.logTrade.softGate',
        },
      });
    }

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

    // Push: governance / rule violation. Fires when the trade was logged despite
    // breaking a rule (i.e. the user overrode a blocking governance check), so
    // the breach is surfaced even if the app was backgrounded. Best-effort.
    if (overridden) {
      void this.notifications.notifyGovernanceViolation(userId, {
        tradeId: created.id,
        governanceLogId: log.id,
        symbol: calculation.symbol,
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
    language: string = 'en',
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

    const { updated, before, after } = await this.prisma.$transaction(
      async (tx) => {
        const closeData = {
          closedPrice: exitPrice,
          closedExchangeRate: closeExchangeRate,
          pnl,
          rMultiple,
          status,
          closedAt: new Date(),
          closedReason: 'manual',
        };
        // Claim the still-open row atomically. A concurrent close that loses
        // this conditional update must not settle PnL or mutate drawdown.
        const claim = await tx.trade.updateMany({
          where: { id: tradeId, userId, status: 'open' },
          data: closeData,
        });
        if (claim.count !== 1) {
          throw new BadRequestException('Trade is not open');
        }
        // Read back the claimed row so database-managed fields (e.g. updatedAt)
        // and any client/schema transformations are preserved in the response.
        const updated =
          (await tx.trade.findUnique({ where: { id: tradeId } })) ??
          ({ ...existing, ...closeData } as trade);

        // Snapshot circuit-breaker flags around settlement to detect new breaches.
        const before = await tx.drawdownState.findUnique({
          where: { userId },
          select: {
            dailyBreached: true,
            weeklyBreached: true,
            monthlyBreached: true,
          },
        });
        // Increment balance + recompute drawdown atomically with the close.
        await this.drawdownService.settleRealizedPnL(tx, userId, pnl);
        const after = await tx.drawdownState.findUnique({
          where: { userId },
          select: {
            dailyBreached: true,
            weeklyBreached: true,
            monthlyBreached: true,
          },
        });

        return { updated, before, after };
      },
    );

    // Push: drawdown circuit breaker(s) this close newly tripped. Best-effort.
    for (const period of newlyBreachedPeriods(before, after)) {
      void this.notifications.notifyDrawdownBreach(userId, period);
    }

    // Phase 2 post-trade grading (spec Sections 6 & 7). Runs AFTER the close
    // transaction has committed and is fully best-effort — gradeClosedTrade
    // never throws, but we void + .catch defensively so it can never affect the
    // close response either.
    void this.postTradeGrading
      .gradeClosedTrade(userId, tradeId, language)
      .catch(() => undefined);

    return updated;
  }

  /**
   * Logs a stop adjustment for an open trade (spec Section 13.2). Appends
   * { ts, oldStop, newStop, reason } to the trade's `stopAdjustments` array AND
   * updates the active `stopLoss` level to the new price. The append is what
   * lets the execution grader detect widened/tightened stops, so logging is
   * kept frictionless — only a positive price and a non-empty reason are
   * required (validated at the DTO).
   */
  async applyStopAdjustment(
    userId: string,
    tradeId: string,
    newStop: number,
    reason: string,
  ): Promise<trade> {
    const existing = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Trade not found');
    }
    if (existing.status !== 'open') {
      throw new BadRequestException('Trade is not open');
    }

    const stopLossJson =
      (existing.stopLoss as { value?: number; pips?: number } | null) ?? {};
    const oldStop =
      typeof stopLossJson.value === 'number' ? stopLossJson.value : 0;

    const adjustment: StopAdjustment = {
      ts: new Date().toISOString(),
      oldStop,
      newStop,
      reason,
    };
    const adjustments = [
      ...(Array.isArray(existing.stopAdjustments)
        ? (existing.stopAdjustments as unknown as StopAdjustment[])
        : []),
      adjustment,
    ];

    const takeProfitJson =
      (existing.takeProfit as { value?: number } | null) ?? {};
    const targetPrice =
      typeof takeProfitJson.value === 'number' && takeProfitJson.value > 0
        ? takeProfitJson.value
        : undefined;
    this.riskCalculationService.validateActiveTradeGeometry({
      symbol: existing.symbol,
      execution: existing.execution as 'buy' | 'sell',
      entry: existing.entry,
      stopPrice: newStop,
      targetPrice,
    });

    let riskPatch: Prisma.tradeUpdateInput = {};
    if (typeof existing.capitalExposurePct === 'number') {
      const calculation =
        await this.riskCalculationService.calculateActiveTrade(
          userId,
          existing.accountCurrency,
          {
            symbol: existing.symbol,
            execution: existing.execution as 'buy' | 'sell',
            entry: existing.entry,
            stopPrice: newStop,
            targetPrice,
            lot: existing.lot,
          },
        );
      const reward =
        calculation.rewardPips !== null
          ? calculation.rewardPips *
            calculation.pipValue *
            calculation.lotSizeRounded
          : 0;

      riskPatch = {
        lot: calculation.lotSizeRounded,
        exchangeRate: calculation.exchangeRate,
        risk: calculation.actualCapitalExposure,
        reward,
        capitalExposure: calculation.actualCapitalExposure,
        capitalExposurePct: calculation.capitalExposurePct,
        stopLoss: {
          ...stopLossJson,
          value: calculation.stopPrice,
          pips: calculation.stopDistancePips,
        } as unknown as Prisma.InputJsonValue,
        takeProfit: {
          ...takeProfitJson,
          value: calculation.targetPrice ?? 0,
          pips: calculation.rewardPips ?? 0,
        } as unknown as Prisma.InputJsonValue,
      };
    }

    return this.prisma.trade.update({
      where: { id: tradeId },
      data: {
        // Preserve the original pips metadata; only the active value moves.
        stopLoss: {
          ...stopLossJson,
          value: newStop,
        } as unknown as Prisma.InputJsonValue,
        stopAdjustments: adjustments as unknown as Prisma.InputJsonValue,
        ...riskPatch,
      },
    });
  }

  /**
   * Settles a manual close that arrives through the generic trade-update path
   * (the app's status menu: `closed_in_profit`/`closed_in_loss`/`reached_tp`/
   * `reached_sl`). Like {@link closeTrade} it computes PnL + R-multiple and, in
   * one transaction, applies the field update AND settles realized PnL onto the
   * balance + drawdown — keeping balance/circuit-breaker correct. It differs from
   * `closeTrade` in two ways: the caller's chosen status is preserved (so the
   * `reached_tp`/`reached_sl` labels survive instead of being collapsed to
   * profit/loss by sign), and the rest of the sanitized update payload is written
   * alongside the close so any same-request field edits persist atomically.
   *
   * The exit price is the client-recorded close price (the app uses the trade's
   * own TP/SL level for these statuses); the exchange rate is re-resolved
   * server-side, never trusted from the client. If no usable exit price is
   * available the trade is still updated, but with no PnL settled.
   */
  async settleManualClose(
    userId: string,
    existing: trade,
    data: Prisma.tradeUpdateInput,
    exitPrice: number,
    language: string = 'en',
  ): Promise<trade> {
    const status =
      typeof data.status === 'string' ? data.status : existing.status;
    const direction = executionToDirection(existing.execution);
    const stopPrice = Number(
      (existing.stopLoss as unknown as { value: number }).value,
    );
    const targetPrice = Number(
      (existing.takeProfit as unknown as { value: number }).value,
    );

    // The settling statuses close at the trade's own protective levels; fall back
    // to the matching stored level if the client didn't supply a usable price.
    const isProfit = status === 'closed_in_profit' || status === 'reached_tp';
    const resolvedExit =
      exitPrice > 0 ? exitPrice : isProfit ? targetPrice : stopPrice;

    const closeExchangeRate = await this.rateResolver.resolveExchangeRate(
      existing.symbol,
      existing.accountCurrency,
    );

    const settles = resolvedExit > 0;
    const pnl = settles
      ? calculatePnL({
          symbol: existing.symbol,
          entryPrice: existing.entry,
          exitPrice: resolvedExit,
          lotSize: existing.lot,
          direction,
          exchangeRate: closeExchangeRate,
        })
      : null;
    const rMultiple = settles
      ? calculateRMultiple(existing.entry, resolvedExit, stopPrice, direction)
      : null;

    // Ensure a risk profile row exists so the balance increment below succeeds.
    await this.riskProfileService.getProfile(userId, existing.accountCurrency);

    const { updated, before, after } = await this.prisma.$transaction(
      async (tx) => {
        const closeData = {
          ...data,
          status,
          closedPrice: settles ? resolvedExit : null,
          closedExchangeRate: closeExchangeRate,
          closedReason:
            typeof data.closedReason === 'string'
              ? data.closedReason
              : 'manual',
          closedAt: (data.closedAt as Date | undefined) ?? new Date(),
          pnl,
          rMultiple,
        } as Prisma.tradeUpdateManyMutationInput;
        // Claim only an open trade owned by this user. This closes the race
        // between the caller's snapshot and settlement of realized PnL.
        const claim = await tx.trade.updateMany({
          where: { id: existing.id, userId, status: 'open' },
          data: closeData,
        });
        if (claim.count !== 1) {
          throw new BadRequestException('Trade is not open');
        }
        const updated =
          (await tx.trade.findUnique({ where: { id: existing.id } })) ??
          ({ ...existing, ...closeData } as trade);

        // Snapshot circuit-breaker flags around settlement to detect new breaches.
        const before = await tx.drawdownState.findUnique({
          where: { userId },
          select: {
            dailyBreached: true,
            weeklyBreached: true,
            monthlyBreached: true,
          },
        });
        if (pnl !== null) {
          // Increment balance + recompute drawdown atomically with the close.
          await this.drawdownService.settleRealizedPnL(tx, userId, pnl);
        }
        const after = await tx.drawdownState.findUnique({
          where: { userId },
          select: {
            dailyBreached: true,
            weeklyBreached: true,
            monthlyBreached: true,
          },
        });

        return { updated, before, after };
      },
    );

    // Push: drawdown circuit breaker(s) this close newly tripped. Best-effort.
    for (const period of newlyBreachedPeriods(before, after)) {
      void this.notifications.notifyDrawdownBreach(userId, period);
    }

    // Phase 2 post-trade grading (spec Sections 6 & 7). Best-effort, post-commit.
    void this.postTradeGrading
      .gradeClosedTrade(userId, existing.id, language)
      .catch(() => undefined);

    return updated;
  }

  /**
   * Deletes a trade and, when that trade had already settled realized PnL onto
   * the account, reverses that settlement atomically so the circuit
   * breaker/drawdown state reflects reality.
   *
   * Only trades closed through a PnL-settling path are reversed. Those are the
   * statuses that called {@link DrawdownService#settleRealizedPnL}: the manual
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

interface BreachFlags {
  dailyBreached: boolean;
  weeklyBreached: boolean;
  monthlyBreached: boolean;
}

/** Periods whose breach flag flipped false→true between two snapshots. */
function newlyBreachedPeriods(
  before: BreachFlags | null,
  after: BreachFlags | null,
): DrawdownPeriod[] {
  if (!after) return [];
  const periods: DrawdownPeriod[] = [];
  if (after.dailyBreached && !before?.dailyBreached) periods.push('daily');
  if (after.weeklyBreached && !before?.weeklyBreached) periods.push('weekly');
  if (after.monthlyBreached && !before?.monthlyBreached)
    periods.push('monthly');
  return periods;
}
