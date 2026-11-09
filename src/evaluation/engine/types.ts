/**
 * Phase 2 Evaluation Engine — shared types (spec Sections 3–8).
 *
 * Everything the engine produces is computed by pure, deterministic TypeScript
 * from the structured data the trader provides — no AI, no I/O. Claude only
 * translates the finished scores into prose (spec Principle 5: "AI coaches,
 * code scores"). `aiCoaching` / `aiSummary` fields are therefore always null at
 * the engine boundary and populated later by the async coaching layer.
 */

// ─── TradingPlan (spec Section 3) ─────────────────────────────────────────────

export type StopPlacement =
  | 'swing_extreme'
  | 'fixed_pips'
  | 'atr_based'
  | 'custom';

export interface TradingPlanEntryConditions {
  requiresMomentumAlignment: boolean;
  requiresPattern: boolean;
  requiresPriceZone: boolean;
  requiresTimeConfluence: boolean;
  requiredCandlestickSignal: boolean;
  customConditions: string;
}

export interface TradingPlanStopRules {
  placement: StopPlacement;
  fixedPips?: number;
  customDescription?: string;
}

export interface TradingPlanExitRules {
  unit1: string;
  unit2: string;
}

export interface TradingPlanSessionRules {
  avoidHighImpactNews: boolean;
  tradingSessionsOnly: string[];
  maxTradesPerDay: number; // 0 = no limit
}

export interface TradingPlan {
  userId: string;
  version: number;
  updatedAt: string;
  entryConditions: TradingPlanEntryConditions;
  stopRules: TradingPlanStopRules;
  exitRules: TradingPlanExitRules;
  sessionRules: TradingPlanSessionRules;
}

// ─── PreTradeChecklist (spec Section 4) ───────────────────────────────────────

export type HigherTfDirection = 'bullish' | 'bearish' | 'unclear';
/**
 * Declared chart pattern (SCRUM-59). `other` carries a free-text
 * `pattern.customName`; `none` covers "no pattern used", which is also what a
 * trader picks when they cannot identify one. The union only ever grows, so
 * older clients sending the original four values keep working.
 *
 * NOTE: no scoring function reads this value — `setup-quality.ts` scores the
 * pattern factor from `identified` + `confidence`, and `plan-adherence.ts` reads
 * only `identified` — so adding values here cannot move any score.
 */
export type PatternType =
  | 'abc_correction'
  | 'five_wave_trend'
  | 'head_and_shoulders'
  | 'inverse_head_and_shoulders'
  | 'double_top'
  | 'double_bottom'
  | 'triple_top'
  | 'triple_bottom'
  | 'ascending_triangle'
  | 'descending_triangle'
  | 'symmetrical_triangle'
  | 'bull_flag'
  | 'bear_flag'
  | 'rising_wedge'
  | 'falling_wedge'
  | 'cup_and_handle'
  | 'other'
  | 'none';
export type Confidence = 'high' | 'medium' | 'low';
export type LevelType =
  | 'fibonacci_retracement'
  | 'fibonacci_extension'
  | 'app'
  | 'support_resistance'
  | 'none';
export type EntryTriggerType =
  | 'trailing_1BH'
  | 'trailing_1BL'
  | 'swing_entry'
  | 'market'
  | 'limit'
  | 'other';
export type StopLogicDeclared = 'swing_extreme' | 'fixed_pips' | 'arbitrary';

export interface PreTradeChecklist {
  tradeId: string;
  submittedAt: string;
  momentum: {
    higherTfDirection: HigherTfDirection;
    lowerTfReversal: boolean;
    note: string;
  };
  pattern: {
    identified: boolean;
    type: PatternType;
    /** Free-text pattern name; only meaningful when `type` is 'other'. */
    customName?: string;
    confidence: Confidence;
    note: string;
  };
  priceZone: {
    atSignificantLevel: boolean;
    levelType: LevelType;
    confluence: boolean;
    note: string;
  };
  timeConfluence: {
    inTimeZone: boolean;
    note: string;
  };
  entryTrigger: {
    type: EntryTriggerType;
    note: string;
  };
  stopPlacement: {
    logic: StopLogicDeclared;
    note: string;
  };
  overallConfidence: Confidence;
  traderNotes: string;
}

// ─── Setup Quality (spec Section 5.1) ─────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type SetupFactor =
  | 'momentum'
  | 'pattern'
  | 'priceZone'
  | 'timeConfluence'
  | 'entryTrigger';

export interface SetupDimension {
  factor: SetupFactor;
  points: number;
  max: number;
}

export interface SetupQualityScore {
  total: number; // 0–100
  grade: Grade;
  breakdown: SetupDimension[];
  highProbability: boolean; // score >= 70
}

// ─── Plan Adherence (spec Section 5.2) ────────────────────────────────────────

export type ViolationSeverity = 'major' | 'minor';

/** Stable English keys for plan-adherence violations (used as i18n keys). */
export type ViolationRule =
  | 'momentumAlignment'
  | 'patternRequired'
  | 'priceZoneRequired'
  | 'timeConfluenceRequired'
  | 'stopPlacement';

export interface PlanViolation {
  rule: ViolationRule;
  severity: ViolationSeverity;
  message: string; // localized via the engine i18n module
}

export interface PlanAdherenceScore {
  total: number; // 0–100
  grade: Grade;
  violations: PlanViolation[];
  ruleBreaker: boolean; // any major violation
}

// ─── Pre-Trade Evaluation (spec Section 5.3) ──────────────────────────────────

export type Recommendation = 'proceed' | 'caution' | 'reconsider';

export interface PreTradeEvaluationResult {
  tradeId: string;
  evaluatedAt: string;
  setupQuality: SetupQualityScore;
  planAdherence: PlanAdherenceScore | null;
  recommendation: Recommendation;
  aiCoaching: string | null; // populated async — never by the engine
}

// ─── Execution Grade (spec Section 6) ─────────────────────────────────────────

export type StopLogic = 'logical' | 'arbitrary' | 'widened' | 'tightened';
export type ExitType =
  | 'stopped_out'
  | 'target_hit'
  | 'manual_early'
  | 'manual_late';

export interface ExecutionGrade {
  tradeId: string;
  gradedAt: string;
  entryQuality: {
    score: number; // 0–100
    actual: number; // actual entry price
    planned: string; // entry trigger type declared
    note: string;
  };
  stopQuality: {
    score: number; // 0–100
    logic: StopLogic;
    note: string;
  };
  exitQuality: {
    score: number;
    rMultiple: number;
    targetR: number | null;
    exitType: ExitType;
    note: string;
  };
  overallExecutionScore: number; // 0–100, weighted average
}

/** One logged stop adjustment (spec Open Question 2 / trade.stopAdjustments). */
export interface StopAdjustment {
  ts: string;
  oldStop: number;
  newStop: number;
  reason: string;
}

/**
 * The view of a trade the execution grader / verdict / behavioral engine needs.
 * Maps from the persisted `trade` row at the service boundary (never here).
 */
export interface TradeRecord {
  id: string;
  direction: 'long' | 'short';
  entryPrice: number;
  stopLoss: number; // original declared stop
  takeProfit: number | null;
  closedPrice: number | null;
  rMultiple: number;
  targetR: number | null; // target R from checklist (if a target was set)
  stopAdjustments: StopAdjustment[];
  openedAt: string;
  closedAt: string | null;
  actualLotSize: number;
  suggestedLotSize: number | null;
}

// ─── Process vs Outcome Verdict (spec Section 7) ──────────────────────────────

export type Verdict = 'good_trade' | 'bad_trade';
export type Outcome = 'win' | 'loss' | 'breakeven';

export type VerdictQuadrant =
  | 'good_process_win'
  | 'good_process_loss'
  | 'bad_process_win'
  | 'bad_process_loss';

export interface TradeVerdict {
  verdict: Verdict;
  lucky: boolean; // won despite breaking rules — most dangerous quadrant
  processScore: number; // composite of setup + adherence + execution (not P&L)
  outcome: Outcome;
  matrix: VerdictQuadrant;
  coachingFocus: string; // which dimension most needs attention
}

// ─── Behavioral Intelligence (spec Section 8) ─────────────────────────────────

export type BehavioralPatternType =
  | 'early_exit'
  | 'stop_widening'
  | 'revenge_trading'
  | 'overtrading'
  | 'rule_breaking_streak'
  | 'inconsistent_sizing'
  | 'lucky_streak'
  | 'chasing_entries'
  | 'weak_setup_bias';

export type PatternSeverity = 'info' | 'warning' | 'critical';

export interface BehavioralPattern {
  type: BehavioralPatternType;
  severity: PatternSeverity;
  confidence: number; // 0–1, based on sample frequency
  sampleSize: number; // how many trades showed this behavior
  totalTrades: number; // total evaluated trades in the analysis window
  evidence: string[]; // specific trade ids that showed the pattern
  metric: string; // the specific number that triggered detection (localized)
}

/**
 * A fully evaluated, closed trade — the unit the behavioral engine analyzes.
 * Carries the pre-eval, execution grade, verdict, and the raw trade fields the
 * detectors need (sizing, timestamps, setup quality).
 */
export interface EvaluatedTrade {
  tradeId: string;
  outcome: Outcome;
  openedAt: string;
  closedAt: string;
  preEval: PreTradeEvaluationResult;
  execGrade: ExecutionGrade;
  verdict: TradeVerdict;
  actualLotSize: number;
  suggestedLotSize: number | null;
  stopAdjustments: StopAdjustment[];
  entryPrice: number;
  direction: 'long' | 'short';
  /**
   * Decision #2: a trade logged while the trader SKIPPED the pre-trade
   * checklist (soft-gate override — Q2 Option 3). A skipped checklist is itself
   * an impulsive-entry signal and counts toward the overtrading and
   * revenge_trading detectors. The pre-eval for a skipped trade still exists
   * (setup quality from defaults / no plan), but this flag records the skip.
   */
  checklistSkipped: boolean;
}

export interface BehavioralReportStats {
  avgProcessScore: number;
  avgSetupQuality: number;
  avgPlanAdherence: number | null;
  avgExecutionScore: number;
  goodTradeRate: number; // % of trades with verdict = 'good_trade'
  luckyTradeRate: number; // % of trades with lucky = true
  winRate: number;
  avgRMultiple: number;
  bestProcessScore: number;
  worstProcessScore: number;
}

export interface BehavioralReport {
  userId: string;
  generatedAt: string;
  tradesAnalyzed: number;
  periodDays: number; // rolling window: 90 days by default
  patterns: BehavioralPattern[]; // empty if < 10 evaluated trades
  summary: string | null; // AI-generated — null at the engine boundary
  topPriority: BehavioralPatternType | null;
  stats: BehavioralReportStats;
}
