/**
 * Shared test fixtures / builders for the Phase 2 evaluation engine specs.
 * Not test code itself (no `.spec` suffix) — pure builders with sane defaults
 * each spec overrides per case.
 */

import { scoreSetupQuality } from './setup-quality';
import { scorePlanAdherence } from './plan-adherence';
import { deriveRecommendation } from './recommendation';
import { scoreExecution } from './execution-grade';
import { computeVerdict } from './verdict';
import {
  EvaluatedTrade,
  ExecutionGrade,
  PreTradeChecklist,
  PreTradeEvaluationResult,
  TradeRecord,
  TradeVerdict,
  TradingPlan,
} from './types';

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function merge<T>(base: T, override?: DeepPartial<T>): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    const existing = (base as Record<string, unknown>)[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      existing &&
      typeof existing === 'object'
    ) {
      out[k] = merge(existing, v as DeepPartial<unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** A perfect-score checklist (setup quality = 100). */
export function makeChecklist(
  override?: DeepPartial<PreTradeChecklist>,
): PreTradeChecklist {
  const base: PreTradeChecklist = {
    tradeId: 'trade-1',
    submittedAt: '2026-06-01T10:00:00.000Z',
    momentum: {
      higherTfDirection: 'bullish',
      lowerTfReversal: true,
      note: '',
    },
    pattern: {
      identified: true,
      type: 'abc_correction',
      confidence: 'high',
      note: '',
    },
    priceZone: {
      atSignificantLevel: true,
      levelType: 'fibonacci_retracement',
      confluence: true,
      note: '',
    },
    timeConfluence: { inTimeZone: true, note: '' },
    entryTrigger: { type: 'trailing_1BH', note: '' },
    stopPlacement: { logic: 'swing_extreme', note: '' },
    overallConfidence: 'high',
    traderNotes: '',
  };
  return merge(base, override);
}

/** A plan requiring all conditions, swing_extreme stops. */
export function makePlan(override?: DeepPartial<TradingPlan>): TradingPlan {
  const base: TradingPlan = {
    userId: 'user-1',
    version: 1,
    updatedAt: '2026-05-01T00:00:00.000Z',
    entryConditions: {
      requiresMomentumAlignment: true,
      requiresPattern: true,
      requiresPriceZone: true,
      requiresTimeConfluence: true,
      requiredCandlestickSignal: false,
      customConditions: '',
    },
    stopRules: { placement: 'swing_extreme' },
    exitRules: { unit1: 'Close at 1R', unit2: 'Trail' },
    sessionRules: {
      avoidHighImpactNews: true,
      tradingSessionsOnly: ['london'],
      maxTradesPerDay: 2,
    },
  };
  return merge(base, override);
}

/** A winning long trade closed at target. */
export function makeTradeRecord(
  override?: DeepPartial<TradeRecord>,
): TradeRecord {
  const base: TradeRecord = {
    id: 'trade-1',
    direction: 'long',
    entryPrice: 1.2,
    stopLoss: 1.19,
    takeProfit: 1.22,
    closedPrice: 1.22,
    rMultiple: 2,
    targetR: 2,
    stopAdjustments: [],
    openedAt: '2026-06-01T10:00:00.000Z',
    closedAt: '2026-06-01T14:00:00.000Z',
    actualLotSize: 1,
    suggestedLotSize: 1,
  };
  return merge(base, override);
}

/** A full pre-trade evaluation result from checklist + plan. */
export function makePreEval(
  checklist: PreTradeChecklist = makeChecklist(),
  plan: TradingPlan | null = makePlan(),
): PreTradeEvaluationResult {
  const setupQuality = scoreSetupQuality(checklist);
  const planAdherence = scorePlanAdherence(checklist, plan);
  return {
    tradeId: checklist.tradeId,
    evaluatedAt: checklist.submittedAt,
    setupQuality,
    planAdherence,
    recommendation: deriveRecommendation(setupQuality, planAdherence),
    aiCoaching: null,
  };
}

/**
 * Builds a fully evaluated trade. Overrides let specs steer outcome, sizing,
 * timestamps, checklist, plan and stop adjustments per behavioral case.
 */
export interface EvaluatedTradeSpec {
  tradeId?: string;
  checklist?: DeepPartial<PreTradeChecklist>;
  plan?: TradingPlan | null;
  trade?: DeepPartial<TradeRecord>;
  checklistSkipped?: boolean;
  /** Override the derived execution grade after computation. */
  execGradeOverride?: DeepPartial<ExecutionGrade>;
  /** Override the derived verdict after computation. */
  verdictOverride?: DeepPartial<TradeVerdict>;
}

export function makeEvaluatedTrade(
  spec: EvaluatedTradeSpec = {},
): EvaluatedTrade {
  const id = spec.tradeId ?? 'trade-1';
  const checklist = makeChecklist({ ...spec.checklist, tradeId: id });
  const plan = spec.plan === undefined ? makePlan() : spec.plan;
  const trade = makeTradeRecord({ ...spec.trade, id });

  const preEval = makePreEval(checklist, plan);
  let execGrade = scoreExecution(trade, checklist);
  if (spec.execGradeOverride) {
    execGrade = merge(execGrade, spec.execGradeOverride);
  }
  let verdict = computeVerdict(preEval, execGrade, trade);
  if (spec.verdictOverride) {
    verdict = merge(verdict, spec.verdictOverride);
  }

  const outcome =
    trade.rMultiple > 0 ? 'win' : trade.rMultiple < 0 ? 'loss' : 'breakeven';

  return {
    tradeId: id,
    outcome,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt ?? trade.openedAt,
    preEval,
    execGrade,
    verdict,
    actualLotSize: trade.actualLotSize,
    suggestedLotSize: trade.suggestedLotSize,
    stopAdjustments: trade.stopAdjustments,
    entryPrice: trade.entryPrice,
    direction: trade.direction,
    checklistSkipped: spec.checklistSkipped ?? false,
  };
}
