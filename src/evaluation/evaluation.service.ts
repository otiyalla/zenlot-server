import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  preTradeEvaluation,
} from '../../prisma/generated/prisma/client';
import {
  deriveRecommendation,
  PlanAdherenceScore,
  PlanViolation,
  PreTradeChecklist,
  PreTradeEvaluationResult,
  scorePlanAdherence,
  scoreSetupQuality,
  SetupDimension,
  SetupQualityScore,
} from './engine';
import { TradingPlanService } from './trading-plan.service';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';

/**
 * Pre-trade evaluation persistence + orchestration (spec Section 5).
 *
 * The actual scoring is done entirely by the pure engine functions
 * (scoreSetupQuality / scorePlanAdherence / deriveRecommendation). This service
 * only maps the DTO into the engine's domain shape, persists the checklist + the
 * computed evaluation, and maps the persisted rows back to the API contract.
 *
 * AI coaching is NOT produced here — `aiCoaching` is always null at this
 * boundary (spec Principle 5: "AI coaches, code scores"). The async coaching
 * enqueue hook is added below for the next increment.
 */
@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tradingPlanService: TradingPlanService,
    private readonly coachingEnqueue: EvaluationCoachingEnqueueService,
  ) {}

  /**
   * Persists a pre-trade checklist (with tradeId still null) and runs the engine
   * against the user's current plan, persisting + returning the evaluation.
   */
  async submitChecklist(
    userId: string,
    dto: SubmitChecklistDto,
    language: string = 'en',
  ): Promise<PreTradeEvaluationResultWithChecklist> {
    const checklistRow = await this.prisma.preTradeChecklist.create({
      data: {
        userId,
        tradeId: null,
        skipped: false,
        checklist: dto as unknown as Prisma.InputJsonValue,
      },
    });

    const plan = await this.tradingPlanService.getCurrentPlan(userId);
    const domainChecklist = this.toDomainChecklist(dto, '');

    const setupQuality = scoreSetupQuality(domainChecklist);
    const planAdherence = scorePlanAdherence(domainChecklist, plan, language);
    const recommendation = deriveRecommendation(setupQuality, planAdherence);

    const evaluationRow = await this.prisma.preTradeEvaluation.create({
      data: {
        userId,
        tradeId: null,
        setupQualityTotal: setupQuality.total,
        setupQualityGrade: setupQuality.grade,
        setupBreakdown:
          setupQuality.breakdown as unknown as Prisma.InputJsonValue,
        planAdherenceTotal: planAdherence?.total ?? null,
        planAdherenceGrade: planAdherence?.grade ?? null,
        planViolations:
          (planAdherence?.violations as unknown as Prisma.InputJsonValue) ??
          Prisma.JsonNull,
        recommendation,
        // aiCoaching stays null — populated later by the async coaching layer.
        aiCoaching: null,
      },
    });

    // ─── Async pre-trade coaching enqueue (spec Section 9) ───────────────────
    // Fire-and-forget: the engine has finished every score above, so we hand the
    // finished PreTradeEvaluationResult to the coaching queue, which fills in
    // `aiCoaching` asynchronously. The enqueue service swallows all errors, so a
    // queue outage can never fail checklist submission — the response below
    // intentionally returns aiCoaching: null and the client renders that null.
    void this.coachingEnqueue
      .enqueuePreTradeCoaching(
        evaluationRow.id,
        {
          tradeId: evaluationRow.tradeId ?? '',
          evaluatedAt: evaluationRow.evaluatedAt.toISOString(),
          setupQuality,
          planAdherence,
          recommendation,
          aiCoaching: null,
        },
        language,
      )
      .catch(() => undefined); // best-effort: a rejected enqueue must never surface

    return this.toResult(evaluationRow, checklistRow.id);
  }

  /**
   * Returns the most recent pre-trade evaluation persisted for a trade, or 404.
   */
  async getPreEvalForTrade(
    userId: string,
    tradeId: string,
  ): Promise<PreTradeEvaluationResultWithChecklist> {
    const evaluationRow = await this.prisma.preTradeEvaluation.findFirst({
      where: { userId, tradeId },
      orderBy: { evaluatedAt: 'desc' },
    });
    if (!evaluationRow) {
      throw new NotFoundException(
        'No pre-trade evaluation found for this trade',
      );
    }
    const checklistRow = await this.prisma.preTradeChecklist.findFirst({
      where: { userId, tradeId, skipped: false },
      orderBy: { submittedAt: 'desc' },
    });
    return this.toResult(evaluationRow, checklistRow?.id ?? null);
  }

  // ─── Soft-gate wiring (decision #2 — warn, never block) ────────────────────

  /**
   * Links a previously-submitted checklist (and its evaluation) to a freshly
   * created trade. Called from the live trade-logging flow when a `checklistId`
   * is supplied. Best-effort and tolerant: it never throws if the checklist is
   * missing / not owned / already linked, so it can never break trade creation.
   *
   * Returns true when a link was made (so the caller can decide whether a skip
   * marker is still needed).
   */
  async linkChecklistToTrade(
    userId: string,
    tradeId: string,
    checklistId: string,
  ): Promise<boolean> {
    const checklist = await this.prisma.preTradeChecklist.findFirst({
      where: { id: checklistId, userId },
    });
    if (!checklist || (checklist.tradeId && checklist.tradeId !== tradeId)) {
      // Unknown / not-owned / already bound to another trade: do not block.
      this.logger.warn(
        `Skipping checklist link: checklist ${checklistId} not linkable to trade ${tradeId}`,
      );
      return false;
    }

    await this.prisma.preTradeChecklist.update({
      where: { id: checklist.id },
      data: { tradeId },
    });

    // Back-fill the matching evaluation(s). The checklist→evaluation pair is
    // created together in submitChecklist, but they are not FK-joined (both
    // carried tradeId null), so we link the user's still-unlinked evaluations.
    await this.prisma.preTradeEvaluation.updateMany({
      where: { userId, tradeId: null },
      data: { tradeId },
    });

    return true;
  }

  /**
   * Records that the trader logged a trade WITHOUT a pre-trade checklist
   * (soft-gate override). The skipped marker maps to
   * EvaluatedTrade.checklistSkipped, which the behavioral engine counts as an
   * impulsive-entry signal (overtrading / revenge_trading detectors). Never
   * blocks trade creation.
   */
  async markChecklistSkipped(userId: string, tradeId: string): Promise<void> {
    await this.prisma.preTradeChecklist.create({
      data: {
        userId,
        tradeId,
        skipped: true,
        checklist: Prisma.JsonNull,
      },
    });
  }

  // ─── Mapping helpers ───────────────────────────────────────────────────────

  /** Maps the submit DTO into the engine's PreTradeChecklist domain shape. */
  private toDomainChecklist(
    dto: SubmitChecklistDto,
    tradeId: string,
  ): PreTradeChecklist {
    return {
      tradeId,
      submittedAt: new Date().toISOString(),
      momentum: dto.momentum,
      pattern: dto.pattern,
      priceZone: dto.priceZone,
      timeConfluence: dto.timeConfluence,
      entryTrigger: dto.entryTrigger,
      stopPlacement: dto.stopPlacement,
      overallConfidence: dto.overallConfidence,
      traderNotes: dto.traderNotes ?? '',
    };
  }

  /** Maps a persisted evaluation row back to the PreTradeEvaluationResult contract. */
  private toResult(
    row: preTradeEvaluation,
    checklistId: string | null,
  ): PreTradeEvaluationResultWithChecklist {
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
      checklistId,
      tradeId: row.tradeId,
      evaluatedAt: row.evaluatedAt.toISOString(),
      setupQuality,
      planAdherence,
      recommendation:
        row.recommendation as PreTradeEvaluationResult['recommendation'],
      aiCoaching: row.aiCoaching ?? null,
    };
  }
}

/**
 * The API response shape for a pre-trade evaluation. Extends the engine's
 * {@link PreTradeEvaluationResult} with the persisted `checklistId` (which the
 * client needs to pass back as the soft-gate link on trade creation) and a
 * nullable `tradeId` (the checklist/evaluation may predate the trade).
 */
export interface PreTradeEvaluationResultWithChecklist extends Omit<
  PreTradeEvaluationResult,
  'tradeId'
> {
  checklistId: string | null;
  tradeId: string | null;
}
