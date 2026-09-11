/**
 * Post-Trade Execution Grading (spec Section 6). Compares what actually happened
 * against what the trader declared in their PreTradeChecklist. Deterministic —
 * no AI, no I/O. Fires when a trade closes.
 *
 * The spec assigns Entry 30, Stop 30, Exit 40 "points" and exposes each sub
 * `score` as 0–100, with `overallExecutionScore` a weighted average. We compute
 * each dimension on its 0–100 scale and combine with weights 0.30 / 0.30 / 0.40,
 * which reproduces the spec's point banding (full entry/stop = 100*0.30 = 30
 * points; full exit = 100*0.40 = 40 points).
 *
 * Product decisions baked in:
 *  - Q4 (entry): Phase 2 has no pip-precise fill price, so objective triggers
 *    that were logged at all get full entry credit; market/subjective entries
 *    get the spec fallback of 20/30 → 67 on the 0–100 scale. The pip banding is
 *    retained in comments for Phase 3 when fill precision arrives.
 *  - Q5 (exitType / stopLogic): both are DERIVED purely from price/R/adjustments
 *    rather than self-reported, via deriveExitType / deriveStopLogic below.
 */

import {
  ExecutionGrade,
  ExitType,
  PreTradeChecklist,
  StopAdjustment,
  StopLogic,
  TradeRecord,
} from './types';

// Sub-scores are on a 0–100 scale; the spec's point values are these scaled by
// the dimension weight (e.g. 30-pt entry = 100 * 0.30).
const ENTRY_FULL = 100;
const ENTRY_SUBJECTIVE = Math.round((20 / 30) * 100); // spec: 20 of 30 pts → 67
const STOP_FULL = 100;
const STOP_ARBITRARY = 0;
// Spec: widened = full minus 10 of the 30 stop points → 20/30 pts → 67 of 100.
const STOP_WIDENED = Math.round(((30 - 10) / 30) * 100);
const EXIT_TARGET_HIT = 100;
const EXIT_STOPPED_OUT = 100;
const EXIT_MANUAL_EARLY = Math.round((15 / 40) * 100); // spec: 15 of 40 pts → 38
const EXIT_MANUAL_LATE = 0;

const ENTRY_WEIGHT = 0.3;
const STOP_WEIGHT = 0.3;
const EXIT_WEIGHT = 0.4;

const OBJECTIVE_TRIGGERS = ['trailing_1BH', 'trailing_1BL'];

/** True if `stop` sits further from `entry` than `reference`, given direction. */
function isFurtherFromEntry(
  direction: TradeRecord['direction'],
  reference: number,
  stop: number,
): boolean {
  // For a long, the stop is below entry; "further" means a lower price.
  // For a short, the stop is above entry; "further" means a higher price.
  return direction === 'long' ? stop < reference : stop > reference;
}

/**
 * Derives stop logic (spec Section 6 + Open Question 2). 'widened' if any logged
 * adjustment moved the stop further from entry after opening (rule break);
 * 'tightened' if an adjustment only moved it closer; otherwise the declared
 * checklist logic maps to 'logical' (swing_extreme / fixed_pips) or 'arbitrary'.
 */
export function deriveStopLogic(
  trade: TradeRecord,
  checklist: PreTradeChecklist,
): StopLogic {
  const adjustments = trade.stopAdjustments ?? [];

  const widened = adjustments.some((a: StopAdjustment) =>
    isFurtherFromEntry(trade.direction, a.oldStop, a.newStop),
  );
  if (widened) return 'widened';

  const tightened = adjustments.some((a: StopAdjustment) =>
    isFurtherFromEntry(trade.direction, a.newStop, a.oldStop),
  );
  if (tightened) return 'tightened';

  // No adjustments moved the stop — fall back to the declared placement logic.
  return checklist.stopPlacement.logic === 'arbitrary'
    ? 'arbitrary'
    : 'logical';
}

/**
 * Derives exit type (spec Section 6 + product decision Q5) from the closed price
 * vs. declared TP / original stop, the realized R-multiple, and the stop
 * adjustment history. Priority:
 *   target_hit   — closed price reached the declared take-profit
 *   manual_late  — a stop-widening adjustment let the trade run to/through the
 *                  ORIGINAL stop before closing (held past stop)
 *   stopped_out  — closed at/through the ORIGINAL stop with no widening
 *   manual_early — closed before target and before the original stop
 */
export function deriveExitType(trade: TradeRecord): ExitType {
  const {
    direction,
    stopLoss,
    takeProfit,
    closedPrice,
    rMultiple,
    stopAdjustments,
  } = trade;

  // No close price recorded — fall back on the realized R sign.
  if (closedPrice === null) {
    return rMultiple > 0 ? 'manual_early' : 'stopped_out';
  }

  // Take-profit sits in the trade's favour: a long's TP is ABOVE entry, a
  // short's BELOW. The stop-loss sits against the trade on the opposite side,
  // so it is compared with the inverse inequality.
  const reachedTarget = (price: number, target: number) =>
    direction === 'long' ? price >= target : price <= target;
  const reachedStop = (price: number, stop: number) =>
    direction === 'long' ? price <= stop : price >= stop;

  // target_hit: closed price reached the declared take-profit.
  if (takeProfit !== null && reachedTarget(closedPrice, takeProfit)) {
    return 'target_hit';
  }

  const hitOriginalStop = reachedStop(closedPrice, stopLoss);
  const widened = (stopAdjustments ?? []).some((a) =>
    isFurtherFromEntry(direction, a.oldStop, a.newStop),
  );

  if (hitOriginalStop) {
    // A widened stop is what allowed price to travel to/through the original
    // level: the trade was held past the stop (manual_late). Otherwise it
    // stopped out cleanly.
    return widened ? 'manual_late' : 'stopped_out';
  }

  // Closed before both target and the original stop — discretionary early exit.
  return 'manual_early';
}

function scoreEntry(checklist: PreTradeChecklist): {
  score: number;
  note: string;
} {
  const triggerType = checklist.entryTrigger.type;
  const objective = OBJECTIVE_TRIGGERS.includes(triggerType);

  if (!objective) {
    // Market / subjective entries can't be verified precisely (Phase 2).
    return {
      score: ENTRY_SUBJECTIVE,
      note: `Subjective ${triggerType} entry — not pip-verifiable in Phase 2`,
    };
  }
  return {
    score: ENTRY_FULL,
    note: `Objective ${triggerType} entry logged`,
  };
}

function scoreStop(logic: StopLogic): { score: number; note: string } {
  switch (logic) {
    case 'widened':
      return {
        score: STOP_WIDENED,
        note: 'Stop widened after entry — rule break',
      };
    case 'arbitrary':
      return {
        score: STOP_ARBITRARY,
        note: 'Stop placement declared arbitrary',
      };
    case 'tightened':
      return { score: STOP_FULL, note: 'Stop tightened — acceptable, logged' };
    case 'logical':
    default:
      return { score: STOP_FULL, note: 'Stop placed logically' };
  }
}

function scoreExit(exitType: ExitType): { score: number; note: string } {
  switch (exitType) {
    case 'target_hit':
      return { score: EXIT_TARGET_HIT, note: 'Target hit per plan' };
    case 'stopped_out':
      return {
        score: EXIT_STOPPED_OUT,
        note: 'Stopped out cleanly — single loss is variance',
      };
    case 'manual_early':
      return { score: EXIT_MANUAL_EARLY, note: 'Exited before target' };
    case 'manual_late':
    default:
      return { score: EXIT_MANUAL_LATE, note: 'Held past the stop level' };
  }
}

export function scoreExecution(
  trade: TradeRecord,
  checklist: PreTradeChecklist,
): ExecutionGrade {
  const stopLogic = deriveStopLogic(trade, checklist);
  const exitType = deriveExitType(trade);

  const entry = scoreEntry(checklist);
  const stop = scoreStop(stopLogic);
  const exit = scoreExit(exitType);

  const overallExecutionScore = Math.round(
    entry.score * ENTRY_WEIGHT +
      stop.score * STOP_WEIGHT +
      exit.score * EXIT_WEIGHT,
  );

  return {
    tradeId: trade.id,
    gradedAt: trade.closedAt ?? new Date().toISOString(),
    entryQuality: {
      score: entry.score,
      actual: trade.entryPrice,
      planned: checklist.entryTrigger.type,
      note: entry.note,
    },
    stopQuality: {
      score: stop.score,
      logic: stopLogic,
      note: stop.note,
    },
    exitQuality: {
      score: exit.score,
      rMultiple: trade.rMultiple,
      targetR: trade.targetR,
      exitType,
      note: exit.note,
    },
    overallExecutionScore,
  };
}

// Re-export so callers can detect chased entries without re-deriving the set.
export { OBJECTIVE_TRIGGERS };
