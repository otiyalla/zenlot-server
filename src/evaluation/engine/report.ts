/**
 * Behavioral Report builder (spec Section 8.3). Assembles a BehavioralReport
 * from a user's evaluated-trade history: runs all detectors, computes the
 * aggregate stats, and picks the top-priority pattern. Pure & deterministic —
 * the `summary` field is left null for the async AI coaching layer to fill.
 *
 * Rolling window: 90 days by default (spec). Trades are filtered to the window
 * by closedAt before analysis. The 10-trade gate is enforced by `detectAll`;
 * stats are still computed for transparency even below the gate (patterns will
 * simply be empty).
 *
 * Decision #3: there is NO aggregate discipline score or streak in the stats.
 * `avgProcessScore` is a descriptive average, not a protectable scoreboard
 * number — a disciplined losing trade lifts it (good_process_loss is rewarded).
 */

import { Language } from '../../risk/engine/i18n';
import { detectAll } from './behavioral';
import {
  BehavioralPattern,
  BehavioralPatternType,
  BehavioralReport,
  BehavioralReportStats,
  EvaluatedTrade,
} from './types';

/** Default rolling analysis window (spec Section 8.3). */
export const DEFAULT_PERIOD_DAYS = 90;

export interface BuildReportOptions {
  periodDays?: number;
  /** Plan session limit for overtrading (0 = no limit). */
  maxTradesPerDay?: number;
  language?: string | Language;
  /** Clock injection for the rolling window (defaults to now). */
  now?: Date;
}

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Filters trades to those closed within the last `periodDays` (inclusive). */
export function filterToWindow(
  trades: EvaluatedTrade[],
  periodDays: number,
  now: Date,
): EvaluatedTrade[] {
  const cutoff = now.getTime() - periodDays * 24 * 60 * 60 * 1000;
  return trades.filter((t) => new Date(t.closedAt).getTime() >= cutoff);
}

/** Computes the aggregate stats block (spec Section 8.3). */
export function computeStats(trades: EvaluatedTrade[]): BehavioralReportStats {
  if (trades.length === 0) {
    return {
      avgProcessScore: 0,
      avgSetupQuality: 0,
      avgPlanAdherence: null,
      avgExecutionScore: 0,
      goodTradeRate: 0,
      luckyTradeRate: 0,
      winRate: 0,
      avgRMultiple: 0,
      bestProcessScore: 0,
      worstProcessScore: 0,
    };
  }

  const processScores = trades.map((t) => t.verdict.processScore);
  const adherenceScores = trades
    .map((t) => t.preEval.planAdherence?.total)
    .filter((v): v is number => v !== undefined && v !== null);

  return {
    avgProcessScore: round(avg(processScores)),
    avgSetupQuality: round(
      avg(trades.map((t) => t.preEval.setupQuality.total)),
    ),
    avgPlanAdherence:
      adherenceScores.length > 0 ? round(avg(adherenceScores)) : null,
    avgExecutionScore: round(
      avg(trades.map((t) => t.execGrade.overallExecutionScore)),
    ),
    goodTradeRate: round(
      trades.filter((t) => t.verdict.verdict === 'good_trade').length /
        trades.length,
      3,
    ),
    luckyTradeRate: round(
      trades.filter((t) => t.verdict.lucky).length / trades.length,
      3,
    ),
    winRate: round(
      trades.filter((t) => t.outcome === 'win').length / trades.length,
      3,
    ),
    avgRMultiple: round(
      avg(trades.map((t) => t.execGrade.exitQuality.rMultiple)),
      2,
    ),
    bestProcessScore: Math.max(...processScores),
    worstProcessScore: Math.min(...processScores),
  };
}

/** The single most urgent pattern to address (detectAll already sorts). */
export function pickTopPriority(
  patterns: BehavioralPattern[],
): BehavioralPatternType | null {
  return patterns.length > 0 ? patterns[0].type : null;
}

/**
 * Builds the full BehavioralReport. `summary` is always null here — the AI
 * coaching layer populates it asynchronously after this returns.
 */
export function buildBehavioralReport(
  userId: string,
  trades: EvaluatedTrade[],
  options: BuildReportOptions = {},
): BehavioralReport {
  const {
    periodDays = DEFAULT_PERIOD_DAYS,
    maxTradesPerDay = 0,
    language = 'en',
    now = new Date(),
  } = options;

  const windowed = filterToWindow(trades, periodDays, now);
  const patterns = detectAll(windowed, { maxTradesPerDay, language });
  const stats = computeStats(windowed);

  return {
    userId,
    generatedAt: now.toISOString(),
    tradesAnalyzed: windowed.length,
    periodDays,
    patterns,
    summary: null, // populated async by the AI coaching layer
    topPriority: pickTopPriority(patterns),
    stats,
  };
}
