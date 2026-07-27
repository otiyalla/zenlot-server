/**
 * Process vs Outcome Verdict (spec Section 7). Computed deterministically from
 * the pre-trade evaluation and the post-trade execution grade — never from P&L.
 * No AI, no I/O.
 *
 * The 2×2 matrix crosses process (good/bad) with outcome (win/loss). The
 * `lucky` quadrant (bad_process_win) is the single most important coaching
 * signal: the trader broke their own rules, the market paid them anyway, and
 * the win risks reinforcing the bad habit. It is flagged explicitly.
 *
 * Product decision #3: there is NO aggregate discipline score or streak. A
 * good_process_loss is reinforced, not penalized — a disciplined losing trade
 * can score highly on process (the "process over outcome" principle made
 * tangible). The verdict here is per-trade only.
 */

import {
  ExecutionGrade,
  Outcome,
  PreTradeEvaluationResult,
  TradeRecord,
  TradeVerdict,
  VerdictQuadrant,
} from './types';

/** Process score >= this threshold counts as "good process" (spec Section 7). */
export const GOOD_PROCESS_THRESHOLD = 65;

/** Composite weights for the process score (spec Section 7). */
export const SETUP_WEIGHT = 0.4;
export const ADHERENCE_WEIGHT = 0.3;
export const EXEC_WEIGHT = 0.3;
/** When no plan exists, adherence weight (0.30) is folded into execution. */
export const EXEC_WEIGHT_NO_PLAN = 0.6;

/**
 * Composite process score from setup quality (40%), plan adherence (30%) and
 * execution (30%). With no plan, adherence is excluded and its weight is
 * redistributed to execution (which becomes 60%). Never reflects P&L.
 */
export function computeProcessScore(
  preEval: PreTradeEvaluationResult,
  execGrade: ExecutionGrade,
): number {
  const hasPlan = preEval.planAdherence !== null;
  const adherenceWeight = hasPlan ? ADHERENCE_WEIGHT : 0;
  const execWeight = hasPlan ? EXEC_WEIGHT : EXEC_WEIGHT_NO_PLAN;

  return Math.round(
    preEval.setupQuality.total * SETUP_WEIGHT +
      (preEval.planAdherence?.total ?? 0) * adherenceWeight +
      execGrade.overallExecutionScore * execWeight,
  );
}

/** Win / loss / breakeven from the realized R-multiple. */
export function deriveOutcome(rMultiple: number): Outcome {
  if (rMultiple > 0) return 'win';
  if (rMultiple < 0) return 'loss';
  return 'breakeven';
}

/**
 * Identifies the dimension that most needs attention, given the matrix and the
 * underlying scores. Returns a stable English key (the AI coaching layer turns
 * this into prose; clients can localize it). For the lucky quadrant the focus
 * is always the rule violations that the win is masking.
 */
export function deriveCoachingFocus(
  preEval: PreTradeEvaluationResult,
  execGrade: ExecutionGrade,
  matrix: VerdictQuadrant,
): string {
  // Lucky: the win hides broken rules — focus there, not on the result.
  if (matrix === 'bad_process_win') {
    return 'lucky_rule_violations';
  }

  // good_process_win / good_process_loss → reinforce; nothing to fix.
  if (matrix === 'good_process_win' || matrix === 'good_process_loss') {
    return 'maintain_process';
  }

  // bad_process_loss → point at the weakest of the three dimensions.
  const setup = preEval.setupQuality.total;
  const adherence = preEval.planAdherence?.total ?? null;
  const exec = execGrade.overallExecutionScore;

  let focus: 'setup_quality' | 'plan_adherence' | 'execution' = 'setup_quality';
  let weakest = setup;

  if (adherence !== null && adherence < weakest) {
    weakest = adherence;
    focus = 'plan_adherence';
  }
  if (exec < weakest) {
    focus = 'execution';
  }
  return focus;
}

/**
 * Computes the full per-trade verdict (spec Section 7). `lucky` is true iff the
 * trade landed in the bad_process_win quadrant.
 */
export function computeVerdict(
  preEval: PreTradeEvaluationResult,
  execGrade: ExecutionGrade,
  trade: TradeRecord,
): TradeVerdict {
  const processScore = computeProcessScore(preEval, execGrade);
  const goodProcess = processScore >= GOOD_PROCESS_THRESHOLD;
  const outcome = deriveOutcome(trade.rMultiple);
  const won = outcome === 'win';

  const matrix: VerdictQuadrant =
    goodProcess && won
      ? 'good_process_win'
      : goodProcess && !won
        ? 'good_process_loss'
        : !goodProcess && won
          ? 'bad_process_win'
          : 'bad_process_loss';

  return {
    verdict: goodProcess ? 'good_trade' : 'bad_trade',
    lucky: matrix === 'bad_process_win',
    processScore,
    outcome,
    matrix,
    coachingFocus: deriveCoachingFocus(preEval, execGrade, matrix),
  };
}
