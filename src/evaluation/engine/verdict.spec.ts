import {
  computeProcessScore,
  computeVerdict,
  deriveCoachingFocus,
  deriveOutcome,
  GOOD_PROCESS_THRESHOLD,
} from './verdict';
import { ExecutionGrade, PreTradeEvaluationResult, TradeRecord } from './types';
import { makeTradeRecord } from './test-fixtures';

function preEval(
  setupTotal: number,
  adherenceTotal: number | null,
): PreTradeEvaluationResult {
  return {
    tradeId: 't',
    evaluatedAt: '2026-06-01T10:00:00Z',
    setupQuality: {
      total: setupTotal,
      grade: 'B',
      breakdown: [],
      highProbability: setupTotal >= 70,
    },
    planAdherence:
      adherenceTotal === null
        ? null
        : {
            total: adherenceTotal,
            grade: 'B',
            violations: [],
            ruleBreaker: false,
          },
    recommendation: 'proceed',
    aiCoaching: null,
  };
}

function execGrade(overall: number): ExecutionGrade {
  return {
    tradeId: 't',
    gradedAt: '2026-06-01T14:00:00Z',
    entryQuality: {
      score: overall,
      actual: 1.2,
      planned: 'trailing_1BH',
      note: '',
    },
    stopQuality: { score: overall, logic: 'logical', note: '' },
    exitQuality: {
      score: overall,
      rMultiple: 1,
      targetR: 2,
      exitType: 'target_hit',
      note: '',
    },
    overallExecutionScore: overall,
  };
}

describe('deriveOutcome', () => {
  it.each([
    [2, 'win'],
    [0.1, 'win'],
    [0, 'breakeven'],
    [-0.1, 'loss'],
    [-2, 'loss'],
  ] as const)('R %s → %s', (r, outcome) => {
    expect(deriveOutcome(r)).toBe(outcome);
  });
});

describe('computeProcessScore', () => {
  it('weights setup 40% / adherence 30% / exec 30% when a plan exists', () => {
    // 100*.4 + 100*.3 + 100*.3 = 100
    expect(computeProcessScore(preEval(100, 100), execGrade(100))).toBe(100);
    // 50*.4 + 80*.3 + 60*.3 = 20 + 24 + 18 = 62
    expect(computeProcessScore(preEval(50, 80), execGrade(60))).toBe(62);
  });

  it('redistributes adherence weight to execution (60%) when no plan', () => {
    // setup 50*.4 + exec 60*.6 = 20 + 36 = 56
    expect(computeProcessScore(preEval(50, null), execGrade(60))).toBe(56);
  });

  it('adherence null contributes nothing and is not counted as 0 at 30%', () => {
    // with plan=null: 100*.4 + 100*.6 = 100, NOT 100*.4 + 0*.3 + 100*.3 = 70
    expect(computeProcessScore(preEval(100, null), execGrade(100))).toBe(100);
  });
});

describe('computeVerdict — 2×2 matrix', () => {
  const winTrade = (): TradeRecord => makeTradeRecord({ rMultiple: 2 });
  const lossTrade = (): TradeRecord =>
    makeTradeRecord({ rMultiple: -1, closedPrice: 1.19 });

  it('good_process_win — followed rules, won → good_trade, not lucky', () => {
    const v = computeVerdict(preEval(100, 100), execGrade(100), winTrade());
    expect(v.matrix).toBe('good_process_win');
    expect(v.verdict).toBe('good_trade');
    expect(v.lucky).toBe(false);
  });

  it('good_process_loss — followed rules, lost → good_trade (rewarded), not lucky', () => {
    const v = computeVerdict(preEval(100, 100), execGrade(100), lossTrade());
    expect(v.matrix).toBe('good_process_loss');
    expect(v.verdict).toBe('good_trade');
    expect(v.lucky).toBe(false);
    expect(v.coachingFocus).toBe('maintain_process');
  });

  it('bad_process_win — broke rules, won → LUCKY flag, bad_trade', () => {
    const v = computeVerdict(preEval(20, 10), execGrade(20), winTrade());
    expect(v.matrix).toBe('bad_process_win');
    expect(v.lucky).toBe(true);
    expect(v.verdict).toBe('bad_trade');
    expect(v.coachingFocus).toBe('lucky_rule_violations');
  });

  it('bad_process_loss — broke rules, lost → bad_trade, focus on weakest dimension', () => {
    const v = computeVerdict(preEval(20, 10), execGrade(20), lossTrade());
    expect(v.matrix).toBe('bad_process_loss');
    expect(v.lucky).toBe(false);
    expect(v.verdict).toBe('bad_trade');
    expect(v.coachingFocus).toBe('plan_adherence'); // adherence 10 is weakest
  });

  it('processScore boundary: exactly 65 is good process', () => {
    // setup 65, no plan, exec 65 → 65*.4 + 65*.6 = 65
    const v = computeVerdict(preEval(65, null), execGrade(65), winTrade());
    expect(v.processScore).toBe(65);
    expect(v.verdict).toBe('good_trade');
    expect(GOOD_PROCESS_THRESHOLD).toBe(65);
  });

  it('processScore just below 65 is bad process', () => {
    // setup 64, no plan, exec 64 → 64
    const v = computeVerdict(preEval(64, null), execGrade(64), winTrade());
    expect(v.processScore).toBe(64);
    expect(v.verdict).toBe('bad_trade');
  });
});

describe('deriveCoachingFocus for bad_process_loss', () => {
  it('points at execution when execution is the weakest dimension', () => {
    expect(
      deriveCoachingFocus(preEval(60, 70), execGrade(10), 'bad_process_loss'),
    ).toBe('execution');
  });
  it('points at setup_quality when setup is the weakest dimension', () => {
    expect(
      deriveCoachingFocus(preEval(10, 70), execGrade(60), 'bad_process_loss'),
    ).toBe('setup_quality');
  });
});
