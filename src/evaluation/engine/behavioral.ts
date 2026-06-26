/**
 * Behavioral Intelligence Engine — detectors (spec Section 8).
 *
 * Each detector is a pure, deterministic function that takes the user's
 * evaluated-trade history and returns a BehavioralPattern or null. No AI — the
 * AI coaching layer turns detected patterns into a narrative, it never detects
 * them. Metric strings are localized via the engine i18n module; stable
 * English `type` keys drive logic.
 *
 * Sample-mass gate (spec Principle 4): NO pattern is surfaced until the user
 * has at least MIN_EVALUATED_TRADES (10) evaluated trades. `detectAll` enforces
 * this; individual detectors additionally apply their own per-pattern minimum
 * sample floor to avoid false positives from small subsamples.
 *
 * Thresholds:
 *  - early_exit, revenge_trading, lucky_streak, inconsistent_sizing: spec 8.2
 *    function bodies (authoritative).
 *  - overtrading, stop_widening, rule_breaking_streak, chasing_entries,
 *    weak_setup_bias: confirmed Q7 thresholds (PHASE2_OPEN_QUESTIONS.md). Each
 *    threshold is a NAMED exported tunable constant below.
 *
 * Decision #2: a skipped pre-trade checklist (EvaluatedTrade.checklistSkipped)
 * is an impulsive-entry signal — it counts toward overtrading (every logged
 * trade, skip or not, counts against the daily limit) and revenge_trading (a
 * post-loss trade with a skipped checklist is treated as the lowest possible
 * adherence for the drop comparison).
 */

import { resolveLanguage, Language } from '../../risk/engine/i18n';
import { patternMetric } from './i18n';
import { BehavioralPattern, EvaluatedTrade, PatternSeverity } from './types';

// ─── Global sample-mass gate (spec Section 8 / Principle 4) ───────────────────

/** No behavioral pattern is surfaced below this many evaluated trades. */
export const MIN_EVALUATED_TRADES = 10;

// ─── Spec 8.2 detector thresholds (authoritative function bodies) ─────────────

export const EARLY_EXIT_MIN_SAMPLE = 5; // winning trades with a target set
export const EARLY_EXIT_RATE = 0.4;
export const EARLY_EXIT_CRITICAL_RATE = 0.6;

export const REVENGE_POST_LOSS_WINDOW_HOURS = 4;
export const REVENGE_MIN_SAMPLE = 3; // post-loss trades
export const REVENGE_ADHERENCE_DROP = 20; // points below overall average

export const LUCKY_STREAK_MIN = 3; // consecutive bad_process_win trades

export const INCONSISTENT_SIZING_DEVIATION = 0.2; // 20% from suggested lot
export const INCONSISTENT_SIZING_RATE = 0.3;
export const INCONSISTENT_SIZING_MIN_SAMPLE = 4;

// ─── Q7 confirmed thresholds (the 5 under-specified detectors) ────────────────

export const OVERTRADING_RATE = 0.3; // ≥30% of active days exceeded the limit
export const OVERTRADING_MIN_ACTIVE_DAYS = 3;

export const STOP_WIDENING_MIN_TRADES = 2; // ≥2 trades with a widening adjustment

export const RULE_BREAKING_STREAK_MIN = 3; // ≥3 consecutive major-violation trades

export const CHASING_ENTRIES_RATE = 0.4; // >40% of objective-trigger trades chased
export const CHASING_ENTRIES_MIN_SAMPLE = 5;

export const WEAK_SETUP_BIAS_THRESHOLD = 55; // setup quality below this is "weak"
export const WEAK_SETUP_BIAS_RATE = 0.5; // >50% of trades weak
export const WEAK_SETUP_BIAS_MIN_SAMPLE = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/** Chronological copy (by openedAt ascending). Does not mutate the input. */
function chronological(trades: EvaluatedTrade[]): EvaluatedTrade[] {
  return [...trades].sort(
    (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
  );
}

/** The most recent trade (by openedAt) that opened strictly before `t`. */
function getImmediatelyPrecedingTrade(
  t: EvaluatedTrade,
  trades: EvaluatedTrade[],
): EvaluatedTrade | undefined {
  const tOpen = new Date(t.openedAt).getTime();
  let best: EvaluatedTrade | undefined;
  let bestOpen = -Infinity;
  for (const other of trades) {
    if (other.tradeId === t.tradeId) continue;
    const open = new Date(other.openedAt).getTime();
    if (open < tOpen && open > bestOpen) {
      best = other;
      bestOpen = open;
    }
  }
  return best;
}

function timeDiffHours(fromIso: string, toIso: string): number {
  return (
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60)
  );
}

/** Local-UTC calendar day key (YYYY-MM-DD) for grouping trades per day. */
function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

// ─── Detectors ──────────────────────────────────────────────────────────────

/**
 * early_exit (spec 8.2): exits before target in >40% of winning trades where a
 * target was set. Critical above 60%.
 */
export function detectEarlyExit(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const winningWithTarget = trades.filter(
    (t) => t.outcome === 'win' && t.execGrade.exitQuality.targetR !== null,
  );
  if (winningWithTarget.length < EARLY_EXIT_MIN_SAMPLE) return null;

  const earlyExits = winningWithTarget.filter(
    (t) => t.execGrade.exitQuality.exitType === 'manual_early',
  );
  const rate = earlyExits.length / winningWithTarget.length;
  if (rate < EARLY_EXIT_RATE) return null;

  const pct = Math.round(rate * 100);
  return {
    type: 'early_exit',
    severity: rate > EARLY_EXIT_CRITICAL_RATE ? 'critical' : 'warning',
    confidence: rate,
    sampleSize: earlyExits.length,
    totalTrades: winningWithTarget.length,
    evidence: earlyExits.map((t) => t.tradeId),
    metric: patternMetric('early_exit', { pct }, lang),
  };
}

/**
 * revenge_trading (spec 8.2): plan adherence drops >20 points in trades opened
 * within 4h of a loss closing, vs the overall average. A skipped checklist on a
 * post-loss trade is treated as adherence 0 (Decision #2).
 */
export function detectRevengeTrading(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);

  const adherenceOf = (t: EvaluatedTrade): number => {
    if (t.checklistSkipped) return 0; // impulsive entry = worst-case adherence
    return t.preEval.planAdherence?.total ?? 100;
  };

  const postLossTrades = trades.filter((t) => {
    const prev = getImmediatelyPrecedingTrade(t, trades);
    return (
      prev?.outcome === 'loss' &&
      prev.closedAt !== null &&
      timeDiffHours(prev.closedAt, t.openedAt) <=
        REVENGE_POST_LOSS_WINDOW_HOURS &&
      timeDiffHours(prev.closedAt, t.openedAt) >= 0
    );
  });
  if (postLossTrades.length < REVENGE_MIN_SAMPLE) return null;

  const avgAdherence = avg(postLossTrades.map(adherenceOf));
  const overallAvg = avg(trades.map(adherenceOf));
  const drop = overallAvg - avgAdherence;
  if (drop < REVENGE_ADHERENCE_DROP) return null;

  return {
    type: 'revenge_trading',
    severity: 'critical',
    confidence: Math.min(drop / 50, 1),
    sampleSize: postLossTrades.length,
    totalTrades: trades.length,
    evidence: postLossTrades.map((t) => t.tradeId),
    metric: patternMetric(
      'revenge_trading',
      { overall: Math.round(overallAvg), after: Math.round(avgAdherence) },
      lang,
    ),
  };
}

/**
 * lucky_streak (spec 8.2): 3+ consecutive bad_process_win (verdict.lucky)
 * trades, in chronological order. Most dangerous behavioral signal.
 */
export function detectLuckyStreak(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const sorted = chronological(trades);

  let streak = 0;
  let maxStreak = 0;
  let currentTrades: string[] = [];
  let streakTrades: string[] = [];

  for (const trade of sorted) {
    if (trade.verdict.lucky) {
      streak++;
      currentTrades.push(trade.tradeId);
      if (streak > maxStreak) {
        maxStreak = streak;
        streakTrades = [...currentTrades];
      }
    } else {
      streak = 0;
      currentTrades = [];
    }
  }

  if (maxStreak < LUCKY_STREAK_MIN) return null;

  return {
    type: 'lucky_streak',
    severity: 'critical',
    confidence: Math.min(maxStreak / 5, 1),
    sampleSize: maxStreak,
    totalTrades: trades.length,
    evidence: streakTrades,
    metric: patternMetric('lucky_streak', { streak: maxStreak }, lang),
  };
}

/**
 * inconsistent_sizing (spec 8.2): lot size deviates >20% from the Risk Engine
 * suggestion in >30% of trades (min 4). Only trades with a suggestion count.
 */
export function detectInconsistentSizing(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const sizingDeviations = trades.filter((t) => {
    if (!t.suggestedLotSize) return false;
    const deviation =
      Math.abs(t.actualLotSize - t.suggestedLotSize) / t.suggestedLotSize;
    return deviation > INCONSISTENT_SIZING_DEVIATION;
  });

  const rate = trades.length > 0 ? sizingDeviations.length / trades.length : 0;
  if (
    rate < INCONSISTENT_SIZING_RATE ||
    sizingDeviations.length < INCONSISTENT_SIZING_MIN_SAMPLE
  ) {
    return null;
  }

  return {
    type: 'inconsistent_sizing',
    severity: 'warning',
    confidence: rate,
    sampleSize: sizingDeviations.length,
    totalTrades: trades.length,
    evidence: sizingDeviations.map((t) => t.tradeId),
    metric: patternMetric(
      'inconsistent_sizing',
      { pct: Math.round(rate * 100) },
      lang,
    ),
  };
}

/**
 * overtrading (Q7): exceeded the daily trade limit on ≥30% of active trading
 * days (min 3 active days). The per-day limit comes from the trade's plan
 * session rules; trades carry it via preEval.planAdherence presence is not
 * enough, so we read the limit off the passed `maxTradesPerDay`. Every logged
 * trade counts toward the daily count, including ones with a skipped checklist
 * (Decision #2).
 */
export function detectOvertrading(
  trades: EvaluatedTrade[],
  maxTradesPerDay: number,
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  if (maxTradesPerDay <= 0) return null; // 0 = no limit → cannot overtrade

  const countsByDay = new Map<string, number>();
  for (const t of trades) {
    const key = dayKey(t.openedAt);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }

  const activeDays = countsByDay.size;
  if (activeDays < OVERTRADING_MIN_ACTIVE_DAYS) return null;

  let exceededDays = 0;
  for (const count of countsByDay.values()) {
    if (count > maxTradesPerDay) exceededDays++;
  }

  const rate = exceededDays / activeDays;
  if (rate < OVERTRADING_RATE) return null;

  return {
    type: 'overtrading',
    severity: rate > 0.6 ? 'critical' : 'warning',
    confidence: rate,
    sampleSize: exceededDays,
    totalTrades: trades.length,
    evidence: trades.map((t) => t.tradeId),
    metric: patternMetric('overtrading', { exceededDays, activeDays }, lang),
  };
}

/**
 * stop_widening (Q7): ≥2 trades that have a stop-adjustment entry which moved
 * the stop further from entry after opening. The execution grader already
 * encodes this as stopQuality.logic === 'widened'.
 */
export function detectStopWidening(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const widened = trades.filter(
    (t) => t.execGrade.stopQuality.logic === 'widened',
  );
  if (widened.length < STOP_WIDENING_MIN_TRADES) return null;

  return {
    type: 'stop_widening',
    severity: widened.length >= 4 ? 'critical' : 'warning',
    confidence: Math.min(widened.length / trades.length, 1),
    sampleSize: widened.length,
    totalTrades: trades.length,
    evidence: widened.map((t) => t.tradeId),
    metric: patternMetric('stop_widening', { count: widened.length }, lang),
  };
}

/**
 * rule_breaking_streak (Q7): ≥3 consecutive trades (chronological) with a major
 * plan violation. A skipped checklist counts as a rule break (Decision #2).
 */
export function detectRuleBreakingStreak(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const sorted = chronological(trades);

  const isRuleBreak = (t: EvaluatedTrade): boolean =>
    t.checklistSkipped || (t.preEval.planAdherence?.ruleBreaker ?? false);

  let streak = 0;
  let maxStreak = 0;
  let current: string[] = [];
  let streakTrades: string[] = [];

  for (const t of sorted) {
    if (isRuleBreak(t)) {
      streak++;
      current.push(t.tradeId);
      if (streak > maxStreak) {
        maxStreak = streak;
        streakTrades = [...current];
      }
    } else {
      streak = 0;
      current = [];
    }
  }

  if (maxStreak < RULE_BREAKING_STREAK_MIN) return null;

  return {
    type: 'rule_breaking_streak',
    severity: 'critical',
    confidence: Math.min(maxStreak / 5, 1),
    sampleSize: maxStreak,
    totalTrades: trades.length,
    evidence: streakTrades,
    metric: patternMetric('rule_breaking_streak', { streak: maxStreak }, lang),
  };
}

/**
 * chasing_entries (Q7): entered beyond the declared trigger on >40% of
 * objective-trigger trades (min 5 objective-trigger trades).
 *
 * A "chase" is signalled by the execution grader scoring entry quality below
 * full (100) on a trade that declared an OBJECTIVE trigger (trailing 1BH/1BL) —
 * i.e. the actual fill overshot the declared trigger. In Phase 2 there is no
 * pip-precise fill, so the grader gives objective entries full credit and this
 * rate is naturally 0 (the detector never false-positives). When Phase 3 adds
 * fill precision and the grader starts docking entry quality for overshoots,
 * this detector activates with no code change. Tests exercise the active path
 * by injecting a sub-100 entry score.
 */
export function detectChasingEntries(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  const OBJECTIVE = ['trailing_1BH', 'trailing_1BL'];

  const objectiveTrades = trades.filter((t) =>
    OBJECTIVE.includes(t.execGrade.entryQuality.planned),
  );
  if (objectiveTrades.length < CHASING_ENTRIES_MIN_SAMPLE) return null;

  // A chase = objective trigger declared but entry quality below full (a pip
  // overshoot recorded by the grader). Phase 2 has no pip data, so this is 0
  // until Phase 3; the threshold logic is ready for it.
  const chased = objectiveTrades.filter(
    (t) => t.execGrade.entryQuality.score < 100,
  );
  const rate = chased.length / objectiveTrades.length;
  if (rate <= CHASING_ENTRIES_RATE) return null;

  return {
    type: 'chasing_entries',
    severity: rate > 0.6 ? 'critical' : 'warning',
    confidence: rate,
    sampleSize: chased.length,
    totalTrades: objectiveTrades.length,
    evidence: chased.map((t) => t.tradeId),
    metric: patternMetric(
      'chasing_entries',
      { pct: Math.round(rate * 100) },
      lang,
    ),
  };
}

/**
 * weak_setup_bias (Q7): setup quality below 55 on >50% of trades (min 8).
 */
export function detectWeakSetupBias(
  trades: EvaluatedTrade[],
  language: string | Language = 'en',
): BehavioralPattern | null {
  const lang = resolveLanguage(language);
  if (trades.length < WEAK_SETUP_BIAS_MIN_SAMPLE) return null;

  const weak = trades.filter(
    (t) => t.preEval.setupQuality.total < WEAK_SETUP_BIAS_THRESHOLD,
  );
  const rate = weak.length / trades.length;
  if (rate <= WEAK_SETUP_BIAS_RATE) return null;

  return {
    type: 'weak_setup_bias',
    severity: rate > 0.7 ? 'critical' : 'warning',
    confidence: rate,
    sampleSize: weak.length,
    totalTrades: trades.length,
    evidence: weak.map((t) => t.tradeId),
    metric: patternMetric(
      'weak_setup_bias',
      { pct: Math.round(rate * 100) },
      lang,
    ),
  };
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

export interface DetectAllOptions {
  /** Plan session limit for overtrading (0 = no limit). Default 0. */
  maxTradesPerDay?: number;
  language?: string | Language;
}

/** Severity ordering for prioritization. */
const SEVERITY_RANK: Record<PatternSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Runs every detector and returns all surfaced patterns, sorted by severity
 * then confidence (most urgent first). Enforces the global 10-trade gate:
 * below MIN_EVALUATED_TRADES, returns [] regardless of any single detector.
 */
export function detectAll(
  trades: EvaluatedTrade[],
  options: DetectAllOptions = {},
): BehavioralPattern[] {
  if (trades.length < MIN_EVALUATED_TRADES) return [];

  const { maxTradesPerDay = 0, language = 'en' } = options;

  const results = [
    detectEarlyExit(trades, language),
    detectRevengeTrading(trades, language),
    detectLuckyStreak(trades, language),
    detectInconsistentSizing(trades, language),
    detectOvertrading(trades, maxTradesPerDay, language),
    detectStopWidening(trades, language),
    detectRuleBreakingStreak(trades, language),
    detectChasingEntries(trades, language),
    detectWeakSetupBias(trades, language),
  ].filter((p): p is BehavioralPattern => p !== null);

  return results.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    return sev !== 0 ? sev : b.confidence - a.confidence;
  });
}
