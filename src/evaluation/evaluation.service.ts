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
import { SetupPatternService } from './setup-pattern.service';
import { normalizeSetupPatternName } from './setup-pattern.util';

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
    private readonly setupPatterns: SetupPatternService,
  ) {}

  /**
   * Normalises the free-text setup pattern name before anything is stored, so
   * the checklist JSON, the library entry and the usage row all agree.
   *
   * `customName` is only meaningful for `type: 'other'` — it is dropped for any
   * other type so a stale value left behind by the client cannot be persisted —
   * and a name that normalises to nothing is dropped entirely rather than
   * stored as an empty string.
   */
  private sanitizeChecklistDto(dto: SubmitChecklistDto): SubmitChecklistDto {
    const { display } =
      dto.pattern.type === 'other'
        ? normalizeSetupPatternName(dto.pattern.customName)
        : { display: '' };

    const pattern = { ...dto.pattern };
    if (display) {
      pattern.customName = display;
    } else {
      delete pattern.customName;
    }

    return { ...dto, pattern };
  }

  /**
   * Persists a pre-trade checklist (with tradeId still null) and runs the engine
   * against the user's current plan, persisting + returning the evaluation.
   */
  async submitChecklist(
    userId: string,
    dto: SubmitChecklistDto,
    language: string = 'en',
  ): Promise<PreTradeEvaluationResultWithChecklist> {
    const sanitized = this.sanitizeChecklistDto(dto);

    const checklistRow = await this.prisma.preTradeChecklist.create({
      data: {
        userId,
        tradeId: null,
        skipped: false,
        checklist: sanitized as unknown as Prisma.InputJsonValue,
      },
    });

    // Record the declared pattern + its library entry. Best-effort: the trader's
    // evaluation must never fail because a suggestion could not be stored.
    try {
      await this.setupPatterns.record(
        userId,
        sanitized.pattern,
        checklistRow.id,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to record setup pattern for checklist ${checklistRow.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    const plan = await this.tradingPlanService.getCurrentPlan(userId);
    const domainChecklist = this.toDomainChecklist(sanitized, '');

    const setupQuality = scoreSetupQuality(domainChecklist);
    const planAdherence = scorePlanAdherence(domainChecklist, plan, language);
    const recommendation = deriveRecommendation(setupQuality, planAdherence);

    const evaluationRow = await this.prisma.preTradeEvaluation.create({
      data: {
        userId,
        tradeId: null,
        checklistId: checklistRow.id,
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
    // Prefer the explicit relation so multiple checklists on one trade cannot
    // cause the response to report a different (most-recent) checklist.
    const checklistRow = evaluationRow.checklistId
      ? await this.prisma.preTradeChecklist.findFirst({
          where: {
            id: evaluationRow.checklistId,
            userId,
            tradeId,
            skipped: false,
          },
        })
      : await this.prisma.preTradeChecklist.findFirst({
          where: { userId, tradeId, skipped: false },
          orderBy: { submittedAt: 'desc' },
        });
    return this.toResult(evaluationRow, checklistRow?.id ?? null);
  }

  /**
   * Returns a pre-trade evaluation by its own id, scoped to the user. This is the
   * pre-trade window retrieval path: the checklist/evaluation are created before
   * any trade exists (tradeId null), so they cannot yet be fetched by tradeId.
   * The client polls this after submitting a checklist to pick up the
   * asynchronously-generated `aiCoaching`. 404 if not found / not owned.
   */
  async getEvalById(
    userId: string,
    evaluationId: string,
  ): Promise<PreTradeEvaluationResultWithChecklist> {
    const evaluationRow = await this.prisma.preTradeEvaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    if (!evaluationRow) {
      throw new NotFoundException('No pre-trade evaluation found');
    }
    return this.toResult(evaluationRow, evaluationRow.checklistId);
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

    // Claim the checklist and its evaluation atomically. The checklist update
    // is conditional on tradeId still being null so that a concurrent request
    // reusing the same checklistId cannot overwrite a race-winner's link.
    const [claimed] = await this.prisma.$transaction([
      this.prisma.preTradeChecklist.updateMany({
        where: { id: checklist.id, tradeId: null },
        data: { tradeId },
      }),
      // Back-fill only the evaluation created for this checklist. Legacy rows
      // may have no checklistId, in which case there is intentionally nothing
      // to link.
      this.prisma.preTradeEvaluation.updateMany({
        where: { checklistId: checklist.id, tradeId: null },
        data: { tradeId },
      }),
    ]);
    if (claimed.count === 0) {
      this.logger.warn(
        `Checklist ${checklistId} was claimed by a concurrent request; skipping link for trade ${tradeId}`,
      );
      return false;
    }

    // Point the declared pattern at the trade it was actually used on. Runs only
    // after we won the claim, and best-effort: this link is reference data, so a
    // failure here must not fail logging the trade.
    try {
      await this.setupPatterns.linkUsageToTrade(userId, checklist.id, tradeId);
    } catch (error) {
      this.logger.warn(
        `Failed to link setup pattern usage for checklist ${checklistId} to trade ${tradeId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

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
      evaluationId: row.id,
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
  /**
   * The evaluation row's own id. The client polls
   * `GET /evaluation/evaluations/:evaluationId` with this to retrieve the
   * asynchronously-generated pre-trade AI coaching during the pre-trade window
   * (before any trade exists, so it cannot yet be fetched by tradeId).
   */
  evaluationId: string;
  checklistId: string | null;
  tradeId: string | null;
}
