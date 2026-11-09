import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  executionGrade,
  trade,
  tradeVerdict,
} from '../../prisma/generated/prisma/client';
import {
  computeVerdict,
  deriveRecommendation,
  ExecutionGrade,
  PlanAdherenceScore,
  PlanViolation,
  PreTradeChecklist,
  PreTradeEvaluationResult,
  scoreExecution,
  scoreSetupQuality,
  SetupDimension,
  SetupQualityScore,
  StopAdjustment,
  TradeRecord,
  TradeVerdict,
} from './engine';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';

/**
 * Post-trade grading orchestration (spec Sections 6 & 7).
 *
 * Fires AFTER a trade-close transaction has committed — never inside it and
 * never blocking it. Everything here is best-effort: any failure is logged +
 * sent to Sentry and swallowed, so post-trade grading can NEVER fail or roll
 * back a trade close. The scoring itself is done entirely by the pure engine
 * (scoreExecution / computeVerdict); this service only maps persisted rows into
 * the engine's domain shapes, persists the results, and enqueues async coaching.
 *
 * Degradation rules when pre-trade data is absent:
 *  - No linked checklist (the trader SKIPPED the soft-gate): we still grade
 *    execution using a NEUTRAL checklist (market entry → subjective; declared
 *    stop logic → arbitrary). Stop-widening/tightening is still detected from
 *    the logged stopAdjustments, which do not depend on the checklist.
 *  - No linked pre-trade evaluation: we SKIP the verdict entirely (the safe
 *    option) — the process score needs setup quality, which only the pre-eval
 *    carries. The execution grade is still persisted on its own.
 */
@Injectable()
export class PostTradeGradingService {
  private readonly logger = new Logger(PostTradeGradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coachingEnqueue: EvaluationCoachingEnqueueService,
  ) {}

  /**
   * Grades a freshly-closed trade: computes + persists the execution grade and
   * (when a pre-eval exists) the verdict, then enqueues post-trade coaching.
   *
   * Best-effort: never throws. Call AFTER the close transaction commits.
   */
  async gradeClosedTrade(
    userId: string,
    tradeId: string,
    language: string = 'en',
  ): Promise<void> {
    try {
      const tradeRow = await this.prisma.trade.findFirst({
        where: { id: tradeId, userId },
      });
      if (!tradeRow) {
        this.logger.warn(`Cannot grade trade ${tradeId}: not found for user`);
        return;
      }

      const domainChecklist = await this.loadDomainChecklist(userId, tradeId);
      const tradeRecord = this.toTradeRecord(tradeRow);

      // ─── Execution grade (spec Section 6) ─────────────────────────────────
      const execGrade = scoreExecution(tradeRecord, domainChecklist);
      await this.persistExecutionGrade(userId, tradeId, execGrade);

      // ─── Verdict (spec Section 7) — needs the pre-eval's setup quality ─────
      // A trade logged without a checklist (soft-gate skipped / "log anyway")
      // has no pre-trade evaluation. Rather than skip the verdict — which would
      // keep the trade out of behavioral insights forever — score the skip as a
      // NEUTRAL worst-case pre-eval (the same neutral checklist already used to
      // grade execution above). The trade then still gets a verdict and counts
      // toward the evaluated-trades gate; the skipped checklist stays an
      // impulsive-entry signal downstream (spec Decision #2).
      const preEval =
        (await this.loadPreEval(userId, tradeId)) ??
        (await this.persistNeutralPreEval(userId, tradeId, domainChecklist));

      const verdict = computeVerdict(preEval, execGrade, tradeRecord);
      const verdictRow = await this.persistVerdict(userId, tradeId, verdict);

      // ─── Async post-trade coaching (spec Section 9) ───────────────────────
      // Fire-and-forget: the verdict is fully computed, so we hand it to the
      // coaching queue, which fills trade_verdicts.ai_coaching asynchronously.
      // The enqueue service swallows its own errors; the extra .catch here
      // guarantees a rejected promise can never surface from this method.
      void this.coachingEnqueue
        .enqueuePostTradeCoaching(verdictRow.id, verdict, language)
        .catch(() => undefined);
    } catch (error) {
      // A grading failure must NEVER fail the trade close. The close has already
      // committed by the time this runs; we only log + report.
      this.logger.error(
        `Post-trade grading failed for trade ${tradeId}`,
        error as Error,
      );
      Sentry.captureException(error, {
        extra: { tradeId, userId, context: 'PostTradeGradingService.grade' },
      });
    }
  }

  /**
   * Returns the persisted execution grade for a trade as the API contract, or
   * throws 404 if the trade has not been graded yet.
   */
  async getExecutionForTrade(
    userId: string,
    tradeId: string,
  ): Promise<ExecutionGrade> {
    const row = await this.prisma.executionGrade.findFirst({
      where: { userId, tradeId },
      orderBy: { gradedAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException('No execution grade found for this trade');
    }
    const tradeRow = await this.prisma.trade.findFirst({
      where: { id: tradeId, userId },
    });
    return this.toExecutionGradeContract(row, tradeRow);
  }

  /**
   * Returns the persisted verdict for a trade as the API contract (including the
   * async ai_coaching column once populated), or throws 404 if none exists.
   */
  async getVerdictForTrade(
    userId: string,
    tradeId: string,
  ): Promise<TradeVerdictWithCoaching> {
    const row = await this.prisma.tradeVerdict.findFirst({
      where: { userId, tradeId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new NotFoundException('No verdict found for this trade');
    }
    return this.toVerdictContract(row);
  }

  // ─── Persistence ─────────────────────────────────────────────────────────

  private async persistExecutionGrade(
    userId: string,
    tradeId: string,
    grade: ExecutionGrade,
  ): Promise<executionGrade> {
    return this.prisma.executionGrade.create({
      data: {
        userId,
        tradeId,
        entryQualityScore: grade.entryQuality.score,
        stopQualityScore: grade.stopQuality.score,
        stopLogic: grade.stopQuality.logic,
        exitQualityScore: grade.exitQuality.score,
        exitType: grade.exitQuality.exitType,
        overallExecutionScore: grade.overallExecutionScore,
      },
    });
  }

  private async persistVerdict(
    userId: string,
    tradeId: string,
    verdict: TradeVerdict,
  ): Promise<tradeVerdict> {
    return this.prisma.tradeVerdict.create({
      data: {
        userId,
        tradeId,
        verdict: verdict.verdict,
        lucky: verdict.lucky,
        processScore: verdict.processScore,
        outcome: verdict.outcome,
        matrix: verdict.matrix,
        coachingFocus: verdict.coachingFocus,
        // aiCoaching stays null — populated later by the async coaching layer.
        aiCoaching: null,
      },
    });
  }

  /**
   * Builds, persists, and returns a NEUTRAL pre-trade evaluation for a trade
   * logged without a checklist (soft-gate skipped / "log anyway"). Scoring the
   * skip as a neutral worst-case setup — the same neutral checklist already used
   * to grade execution — lets the trade still receive a verdict and therefore
   * count toward behavioral insights, instead of being excluded forever. Plan
   * adherence is left null (there is no self-reported checklist to grade
   * against), which folds its process-score weight into execution. Persisting
   * the row keeps the read paths (assembleEvaluatedTrades / getPreEvalForTrade)
   * unchanged: every verdict keeps a backing pre-eval.
   */
  private async persistNeutralPreEval(
    userId: string,
    tradeId: string,
    checklist: PreTradeChecklist,
  ): Promise<PreTradeEvaluationResult> {
    const setupQuality = scoreSetupQuality(checklist);
    const recommendation = deriveRecommendation(setupQuality, null);

    const row = await this.prisma.preTradeEvaluation.create({
      data: {
        userId,
        tradeId,
        // No checklistId: the trader skipped the soft-gate, so there is no
        // submitted checklist/evaluation pair to link to.
        setupQualityTotal: setupQuality.total,
        setupQualityGrade: setupQuality.grade,
        setupBreakdown:
          setupQuality.breakdown as unknown as Prisma.InputJsonValue,
        planAdherenceTotal: null,
        planAdherenceGrade: null,
        planViolations: Prisma.JsonNull,
        recommendation,
        aiCoaching: null,
      },
    });

    return {
      tradeId,
      evaluatedAt: row.evaluatedAt.toISOString(),
      setupQuality,
      planAdherence: null,
      recommendation,
      aiCoaching: null,
    };
  }

  // ─── Domain mapping ──────────────────────────────────────────────────────

  /**
   * Maps a persisted trade row into the engine's TradeRecord. Reads the nested
   * stopLoss/takeProfit JSON ({ value, pips }) for the protective levels and the
   * stopAdjustments JSON array for the widened/tightened detection.
   */
  private toTradeRecord(row: trade): TradeRecord {
    const stopLoss = this.readLevel(row.stopLoss);
    const takeProfit = this.readLevel(row.takeProfit);
    const direction: TradeRecord['direction'] =
      row.execution === 'buy' ? 'long' : 'short';

    return {
      id: row.id,
      direction,
      entryPrice: row.entry,
      stopLoss,
      takeProfit: takeProfit === 0 ? null : takeProfit,
      closedPrice: row.closedPrice,
      rMultiple: row.rMultiple ?? 0,
      // rr is the planned reward-to-risk recorded at sizing; it is the target R.
      targetR: row.rr || null,
      stopAdjustments: this.readStopAdjustments(row.stopAdjustments),
      openedAt: row.createdAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      actualLotSize: row.lot,
      suggestedLotSize: row.suggestedLot,
    };
  }

  /** Reads a { value: number } level JSON; returns 0 when unreadable. */
  private readLevel(level: unknown): number {
    if (
      typeof level === 'object' &&
      level !== null &&
      'value' in level &&
      typeof (level as { value: unknown }).value === 'number'
    ) {
      return (level as { value: number }).value;
    }
    return 0;
  }

  private readStopAdjustments(raw: unknown): StopAdjustment[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (a): a is StopAdjustment =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as StopAdjustment).oldStop === 'number' &&
        typeof (a as StopAdjustment).newStop === 'number',
    );
  }

  /**
   * Loads the linked, non-skipped pre-trade checklist for a trade and maps it to
   * the engine's domain shape. When the checklist was SKIPPED or is absent, a
   * neutral checklist is returned so execution can still be graded (see class
   * doc): a market (subjective) entry and an arbitrary declared stop. The
   * widened/tightened stop signal comes from stopAdjustments, not the checklist.
   */
  private async loadDomainChecklist(
    userId: string,
    tradeId: string,
  ): Promise<PreTradeChecklist> {
    const row = await this.prisma.preTradeChecklist.findFirst({
      where: { userId, tradeId, skipped: false },
      orderBy: { submittedAt: 'desc' },
    });

    if (!row || row.checklist === null) {
      return this.neutralChecklist(tradeId);
    }

    const c = row.checklist as unknown as Partial<PreTradeChecklist>;
    // Only entryTrigger.type and stopPlacement.logic are read by scoreExecution;
    // fall back to neutral values for any missing pieces.
    return {
      ...this.neutralChecklist(tradeId),
      ...c,
      tradeId,
      entryTrigger: c.entryTrigger ?? { type: 'market', note: '' },
      stopPlacement: c.stopPlacement ?? { logic: 'arbitrary', note: '' },
    };
  }

  /** A neutral checklist for a skipped/absent soft-gate (worst-case grading). */
  private neutralChecklist(tradeId: string): PreTradeChecklist {
    return {
      tradeId,
      submittedAt: new Date().toISOString(),
      momentum: {
        higherTfDirection: 'unclear',
        lowerTfReversal: false,
        note: '',
      },
      pattern: { identified: false, type: 'none', confidence: 'low', note: '' },
      priceZone: {
        atSignificantLevel: false,
        levelType: 'none',
        confluence: false,
        note: '',
      },
      timeConfluence: { inTimeZone: false, note: '' },
      entryTrigger: { type: 'market', note: '' },
      stopPlacement: { logic: 'arbitrary', note: '' },
      overallConfidence: 'low',
      traderNotes: '',
    };
  }

  /** Loads + maps the linked pre-trade evaluation row, or null if none exists. */
  private async loadPreEval(
    userId: string,
    tradeId: string,
  ): Promise<PreTradeEvaluationResult | null> {
    const row = await this.prisma.preTradeEvaluation.findFirst({
      where: { userId, tradeId },
      orderBy: { evaluatedAt: 'desc' },
    });
    if (!row) return null;

    const setupQuality: SetupQualityScore = {
      total: row.setupQualityTotal,
      grade: row.setupQualityGrade as SetupQualityScore['grade'],
      breakdown: (row.setupBreakdown as unknown as SetupDimension[]) ?? [],
      highProbability: row.setupQualityTotal >= 70,
    };

    const planAdherence: PlanAdherenceScore | null =
      row.planAdherenceTotal === null || row.planAdherenceGrade === null
        ? null
        : {
            total: row.planAdherenceTotal,
            grade: row.planAdherenceGrade as PlanAdherenceScore['grade'],
            violations:
              (row.planViolations as unknown as PlanViolation[]) ?? [],
            ruleBreaker: (
              (row.planViolations as unknown as PlanViolation[]) ?? []
            ).some((v) => v.severity === 'major'),
          };

    return {
      tradeId,
      evaluatedAt: row.evaluatedAt.toISOString(),
      setupQuality,
      planAdherence,
      recommendation:
        row.recommendation as PreTradeEvaluationResult['recommendation'],
      aiCoaching: row.aiCoaching ?? null,
    };
  }

  // ─── API contract mapping ────────────────────────────────────────────────

  private toExecutionGradeContract(
    row: executionGrade,
    tradeRow: trade | null,
  ): ExecutionGrade {
    return {
      tradeId: row.tradeId,
      gradedAt: row.gradedAt.toISOString(),
      entryQuality: {
        score: row.entryQualityScore,
        actual: tradeRow?.entry ?? 0,
        planned: '',
        note: '',
      },
      stopQuality: {
        score: row.stopQualityScore,
        logic: row.stopLogic as ExecutionGrade['stopQuality']['logic'],
        note: '',
      },
      exitQuality: {
        score: row.exitQualityScore,
        rMultiple: tradeRow?.rMultiple ?? 0,
        targetR: tradeRow?.rr || null,
        exitType: row.exitType as ExecutionGrade['exitQuality']['exitType'],
        note: '',
      },
      overallExecutionScore: row.overallExecutionScore,
    };
  }

  private toVerdictContract(row: tradeVerdict): TradeVerdictWithCoaching {
    return {
      verdict: row.verdict as TradeVerdict['verdict'],
      lucky: row.lucky,
      processScore: row.processScore,
      outcome: row.outcome as TradeVerdict['outcome'],
      matrix: row.matrix as TradeVerdict['matrix'],
      coachingFocus: row.coachingFocus ?? '',
      aiCoaching: row.aiCoaching ?? null,
    };
  }
}

/**
 * API response shape for a verdict: the engine's {@link TradeVerdict} plus the
 * async `aiCoaching` column (null until the coaching processor populates it).
 */
export interface TradeVerdictWithCoaching extends TradeVerdict {
  aiCoaching: string | null;
}
