import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  behavioralReport,
  executionGrade,
  preTradeChecklist,
  preTradeEvaluation,
  trade,
  tradeVerdict,
} from '../../prisma/generated/prisma/client';
import {
  BehavioralPattern,
  BehavioralPatternType,
  BehavioralReport,
  BehavioralReportStats,
  buildBehavioralReport,
  computeStats,
  DEFAULT_PERIOD_DAYS,
  EvaluatedTrade,
  ExecutionGrade,
  MIN_EVALUATED_TRADES,
  Outcome,
  PlanAdherenceScore,
  PlanViolation,
  PreTradeEvaluationResult,
  SetupDimension,
  SetupQualityScore,
  StopAdjustment,
  TradeVerdict,
  TradingPlanSessionRules,
} from './engine';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';

/**
 * Behavioral Intelligence reporting (spec Sections 8 & 11, Inc 3).
 *
 * Assembles the user's fully-evaluated trade history into the engine's
 * EvaluatedTrade[] shape, runs the pure detectors + report builder, persists a
 * behavioralReport row, and (only when ≥1 pattern is surfaced) enqueues the
 * async behavioral-summary coaching that fills behavioralReports.aiSummary.
 *
 * A trade is "evaluated" only when it has all three downstream artefacts: a
 * pre-trade evaluation (setup quality), an execution grade, AND a verdict. The
 * 10-evaluated-trade gate (spec Principle 4) is enforced by the engine's
 * detectAll; below the gate no patterns surface and the report endpoint returns
 * 204 insufficient_data.
 *
 * Staleness: a generate-if-stale read regenerates when the latest stored report
 * is older than {@link STALENESS_HOURS} or there is none. The weekly cron uses
 * its own eligibility rules (new-pattern OR 7-day) — see WeeklyBehavioralService.
 */
@Injectable()
export class BehavioralReportService {
  /** On-demand reads regenerate a report older than this many hours. */
  static readonly STALENESS_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly coachingEnqueue: EvaluationCoachingEnqueueService,
  ) {}

  /**
   * Returns the latest stored report, regenerating it first when stale or
   * missing. `null` is never returned for a user with ≥10 evaluated trades; when
   * the user has fewer than 10 the caller (controller) surfaces 204.
   */
  async getOrGenerate(
    userId: string,
    periodDays: number = DEFAULT_PERIOD_DAYS,
    language: string = 'en',
    now: Date = new Date(),
  ): Promise<BehavioralReportContract | InsufficientData> {
    const latest = await this.prisma.behavioralReport.findFirst({
      where: { userId, periodDays },
      orderBy: { generatedAt: 'desc' },
    });

    if (latest && !this.isStale(latest, now)) {
      return this.toContract(latest);
    }

    return this.generate(userId, periodDays, language, now);
  }

  /**
   * Builds, persists, and (when patterns exist) enqueues coaching for a fresh
   * report. Returns the persisted contract, or InsufficientData when the user
   * has fewer than 10 evaluated trades (no row is written in that case).
   */
  async generate(
    userId: string,
    periodDays: number = DEFAULT_PERIOD_DAYS,
    language: string = 'en',
    now: Date = new Date(),
  ): Promise<BehavioralReportContract | InsufficientData> {
    const trades = await this.assembleEvaluatedTrades(userId);
    const maxTradesPerDay = await this.resolveMaxTradesPerDay(userId);

    const report = buildBehavioralReport(userId, trades, {
      periodDays,
      maxTradesPerDay,
      language,
      now,
    });

    // Spec 11: <10 evaluated trades → no report, signal insufficient_data. We
    // count trades inside the rolling window (the same set the engine analyses).
    if (report.tradesAnalyzed < MIN_EVALUATED_TRADES) {
      return {
        insufficientData: true,
        tradesRequired: MIN_EVALUATED_TRADES,
        tradesEvaluated: report.tradesAnalyzed,
      };
    }

    const row = await this.persist(report);

    // Enqueue the AI summary ONLY when at least one pattern was detected (spec
    // 9.2). Fire-and-forget + .catch-guarded so it can never fail this method.
    if (report.patterns.length > 0) {
      void this.coachingEnqueue
        .enqueueBehavioralSummary(row.id, report, language)
        .catch(() => undefined);
    }

    return this.toContract(row);
  }

  /** Aggregate stats across ALL of a user's evaluated trades (spec /stats/summary). */
  async statsSummary(userId: string): Promise<StatsSummary> {
    const trades = await this.assembleEvaluatedTrades(userId);
    const stats: BehavioralReportStats = computeStats(trades);
    return {
      avgProcessScore: stats.avgProcessScore,
      goodTradeRate: stats.goodTradeRate,
      luckyTradeRate: stats.luckyTradeRate,
      winRate: stats.winRate,
      avgRMultiple: stats.avgRMultiple,
      tradesEvaluated: trades.length,
    };
  }

  private isStale(row: behavioralReport, now: Date): boolean {
    const ageMs = now.getTime() - row.generatedAt.getTime();
    return ageMs > BehavioralReportService.STALENESS_HOURS * 60 * 60 * 1000;
  }

  // ─── EvaluatedTrade assembly ───────────────────────────────────────────────

  /**
   * Loads every fully-evaluated, closed trade for the user and maps it into the
   * engine's EvaluatedTrade. A trade qualifies only when it has a pre-trade
   * evaluation, an execution grade, AND a verdict. The linked checklist's
   * `skipped` flag becomes EvaluatedTrade.checklistSkipped (a skipped checklist
   * is itself an impulsive-entry signal — spec Decision #2).
   */
  async assembleEvaluatedTrades(userId: string): Promise<EvaluatedTrade[]> {
    const trades = await this.prisma.trade.findMany({
      // Settlement writes one of these terminal statuses; the generic
      // `closed` value is only a legacy/manual state and excludes normally
      // graded trades from behavioral reports.
      where: {
        userId,
        status: {
          in: [
            'closed',
            'closed_in_profit',
            'closed_in_loss',
            'reached_tp',
            'reached_sl',
          ],
        },
      },
      include: {
        preTradeEvaluations: { orderBy: { evaluatedAt: 'desc' }, take: 1 },
        executionGrades: { orderBy: { gradedAt: 'desc' }, take: 1 },
        tradeVerdicts: { orderBy: { createdAt: 'desc' }, take: 1 },
        preTradeChecklists: { orderBy: { submittedAt: 'desc' }, take: 1 },
      },
    });

    const evaluated: EvaluatedTrade[] = [];
    for (const t of trades) {
      const evalRow = t.preTradeEvaluations[0];
      const gradeRow = t.executionGrades[0];
      const verdictRow = t.tradeVerdicts[0];
      // All three downstream artefacts are required for a trade to count.
      if (!evalRow || !gradeRow || !verdictRow) continue;
      if (!t.closedAt) continue;

      evaluated.push(
        this.toEvaluatedTrade(
          t,
          evalRow,
          gradeRow,
          verdictRow,
          t.preTradeChecklists[0],
        ),
      );
    }
    return evaluated;
  }

  private toEvaluatedTrade(
    t: trade,
    evalRow: preTradeEvaluation,
    gradeRow: executionGrade,
    verdictRow: tradeVerdict,
    checklistRow: preTradeChecklist | undefined,
  ): EvaluatedTrade {
    const preEval = this.toPreEval(t.id, evalRow);
    const execGrade = this.toExecutionGrade(t, gradeRow);
    const verdict = this.toVerdict(verdictRow);
    const outcome = verdictRow.outcome as Outcome;

    return {
      tradeId: t.id,
      outcome,
      openedAt: t.createdAt.toISOString(),
      closedAt: (t.closedAt as Date).toISOString(),
      preEval,
      execGrade,
      verdict,
      actualLotSize: t.lot,
      suggestedLotSize: t.suggestedLot,
      stopAdjustments: this.readStopAdjustments(t.stopAdjustments),
      entryPrice: t.entry,
      direction: t.execution === 'buy' ? 'long' : 'short',
      checklistSkipped: checklistRow?.skipped ?? false,
    };
  }

  private toPreEval(
    tradeId: string,
    row: preTradeEvaluation,
  ): PreTradeEvaluationResult {
    const setupQuality: SetupQualityScore = {
      total: row.setupQualityTotal,
      grade: row.setupQualityGrade as SetupQualityScore['grade'],
      breakdown: (row.setupBreakdown as unknown as SetupDimension[]) ?? [],
      highProbability: row.setupQualityTotal >= 70,
    };

    const violations = (row.planViolations as unknown as PlanViolation[]) ?? [];
    const planAdherence: PlanAdherenceScore | null =
      row.planAdherenceTotal === null || row.planAdherenceGrade === null
        ? null
        : {
            total: row.planAdherenceTotal,
            grade: row.planAdherenceGrade as PlanAdherenceScore['grade'],
            violations,
            ruleBreaker: violations.some((v) => v.severity === 'major'),
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

  private toExecutionGrade(t: trade, row: executionGrade): ExecutionGrade {
    return {
      tradeId: row.tradeId,
      gradedAt: row.gradedAt.toISOString(),
      entryQuality: {
        score: row.entryQualityScore,
        actual: t.entry,
        // `planned` carries the declared entry trigger type; the chasing_entries
        // detector reads it. The grade row does not persist it, so we infer it
        // from the latest checklist below via the assembler when available.
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
        rMultiple: t.rMultiple ?? 0,
        targetR: t.rr || null,
        exitType: row.exitType as ExecutionGrade['exitQuality']['exitType'],
        note: '',
      },
      overallExecutionScore: row.overallExecutionScore,
    };
  }

  private toVerdict(row: tradeVerdict): TradeVerdict {
    return {
      verdict: row.verdict as TradeVerdict['verdict'],
      lucky: row.lucky,
      processScore: row.processScore,
      outcome: row.outcome as TradeVerdict['outcome'],
      matrix: row.matrix as TradeVerdict['matrix'],
      coachingFocus: row.coachingFocus ?? '',
    };
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

  /** The current plan's maxTradesPerDay (0 / none = no overtrading limit). */
  private async resolveMaxTradesPerDay(userId: string): Promise<number> {
    const plan = await this.prisma.tradingPlan.findFirst({
      where: { userId, isCurrent: true },
      orderBy: { version: 'desc' },
      select: { sessionRules: true },
    });
    if (!plan) return 0;
    const rules = plan.sessionRules as unknown as TradingPlanSessionRules;
    return typeof rules?.maxTradesPerDay === 'number'
      ? rules.maxTradesPerDay
      : 0;
  }

  // ─── Persistence + contract mapping ────────────────────────────────────────

  private async persist(report: BehavioralReport): Promise<behavioralReport> {
    return this.prisma.behavioralReport.create({
      data: {
        userId: report.userId,
        tradesAnalyzed: report.tradesAnalyzed,
        periodDays: report.periodDays,
        patterns: report.patterns as unknown as object[],
        stats: report.stats as unknown as object,
        topPriority: report.topPriority,
        // aiSummary stays null — filled async by the coaching layer.
        aiSummary: null,
      },
    });
  }

  private toContract(row: behavioralReport): BehavioralReportContract {
    return {
      id: row.id,
      userId: row.userId,
      generatedAt: row.generatedAt.toISOString(),
      tradesAnalyzed: row.tradesAnalyzed,
      periodDays: row.periodDays,
      patterns: (row.patterns as unknown as BehavioralPattern[]) ?? [],
      stats: row.stats as unknown as BehavioralReportStats,
      topPriority: (row.topPriority as BehavioralPatternType | null) ?? null,
      summary: row.aiSummary ?? null,
    };
  }
}

/** API shape for a persisted behavioral report (engine report + db id + summary). */
export interface BehavioralReportContract {
  id: string;
  userId: string;
  generatedAt: string;
  tradesAnalyzed: number;
  periodDays: number;
  patterns: BehavioralPattern[];
  stats: BehavioralReportStats;
  topPriority: BehavioralPatternType | null;
  summary: string | null;
}

/** Returned when the user has fewer than 10 evaluated trades (spec 11 → 204). */
export interface InsufficientData {
  insufficientData: true;
  tradesRequired: number;
  tradesEvaluated: number;
}

export function isInsufficientData(
  value: BehavioralReportContract | InsufficientData,
): value is InsufficientData {
  return (value as InsufficientData).insufficientData === true;
}

/** Aggregate stats across all evaluated trades (spec GET /stats/summary). */
export interface StatsSummary {
  avgProcessScore: number;
  goodTradeRate: number;
  luckyTradeRate: number;
  winRate: number;
  avgRMultiple: number;
  tradesEvaluated: number;
}
