import { Injectable } from '@nestjs/common';

/**
 * Phase 2 entitlements seam (Open Question Q1 — decision: ship UNGATED).
 *
 * Spec Section 12 gates a set of evaluation features behind the Pro tier, but
 * Phase 1 deliberately shipped ungated and there is NO `tier` column on the
 * user model. We keep that decision: `canAccess` ALWAYS returns true so every
 * authenticated user gets the full Pro experience while Phases 0–3 are built
 * and demoed.
 *
 * This is the single seam Phase 4 billing flips: once a tier source of truth
 * exists, `canAccess` resolves the user's entitlement instead of returning a
 * constant. Flipping it is a body change here, not a rewrite at every call
 * site — every gated surface should consult this service rather than checking
 * a tier inline.
 */

/** The Pro-only evaluation features named in spec Section 12. */
export enum EvaluationFeature {
  PreTradeChecklist = 'pre_trade_checklist',
  SetupQualityScore = 'setup_quality_score',
  PlanAdherenceScore = 'plan_adherence_score',
  ExecutionGrade = 'execution_grade',
  ProcessVsOutcomeVerdict = 'process_vs_outcome_verdict',
  LuckyFlag = 'lucky_flag',
  AiCoachingPerTrade = 'ai_coaching_per_trade',
  BehavioralReport = 'behavioral_report',
  BehavioralPatternHistory = 'behavioral_pattern_history',
  TradingPlanVersioning = 'trading_plan_versioning',
}

/** The minimal user shape this service needs (no tier column today). */
export interface EntitledUser {
  id: string;
}

@Injectable()
export class EntitlementsService {
  /**
   * Whether `user` may access `feature`.
   *
   * Phase 2: ALWAYS true (ungated). Phase 4 billing flips this to resolve the
   * user's tier and compare against the feature's required tier.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canAccess(feature: EvaluationFeature, user: EntitledUser): boolean {
    // Ungated for Phase 2. Do not gate here until billing exists (Phase 4).
    return true;
  }
}
