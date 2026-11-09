import {
  deriveExitType,
  deriveStopLogic,
  scoreExecution,
} from './execution-grade';
import { makeChecklist, makeTradeRecord } from './test-fixtures';

describe('deriveStopLogic', () => {
  it('logical when declared swing_extreme and no adjustments', () => {
    expect(
      deriveStopLogic(
        makeTradeRecord(),
        makeChecklist({ stopPlacement: { logic: 'swing_extreme' } }),
      ),
    ).toBe('logical');
  });

  it('arbitrary when declared arbitrary and no adjustments', () => {
    expect(
      deriveStopLogic(
        makeTradeRecord(),
        makeChecklist({ stopPlacement: { logic: 'arbitrary' } }),
      ),
    ).toBe('arbitrary');
  });

  it('widened when a long stop is moved lower (further from entry)', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.18,
          reason: 'gave it room',
        },
      ],
    });
    expect(deriveStopLogic(trade, makeChecklist())).toBe('widened');
  });

  it('widened when a short stop is moved higher (further from entry)', () => {
    const trade = makeTradeRecord({
      direction: 'short',
      entryPrice: 1.2,
      stopLoss: 1.21,
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.21,
          newStop: 1.22,
          reason: 'x',
        },
      ],
    });
    expect(deriveStopLogic(trade, makeChecklist())).toBe('widened');
  });

  it('tightened when a long stop is moved closer with no widening', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.195,
          reason: 'lock in',
        },
      ],
    });
    expect(deriveStopLogic(trade, makeChecklist())).toBe('tightened');
  });

  it('widening takes precedence over a later tightening', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.18,
          reason: 'widen',
        },
        {
          ts: '2026-06-01T12:00:00Z',
          oldStop: 1.18,
          newStop: 1.185,
          reason: 'tighten',
        },
      ],
    });
    expect(deriveStopLogic(trade, makeChecklist())).toBe('widened');
  });
});

describe('deriveExitType', () => {
  it('target_hit when long closed at/through take-profit', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      closedPrice: 1.22,
    });
    expect(deriveExitType(trade)).toBe('target_hit');
  });

  it('stopped_out when long closed at original stop with no widening', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.19,
      rMultiple: -1,
      stopAdjustments: [],
    });
    expect(deriveExitType(trade)).toBe('stopped_out');
  });

  it('manual_late when a widened stop let price run to the original stop', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.185, // through original stop
      rMultiple: -1.5,
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.18,
          reason: 'hope',
        },
      ],
    });
    expect(deriveExitType(trade)).toBe('manual_late');
  });

  it('manual_early when closed before both target and original stop', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.21, // in profit, short of target
      rMultiple: 1,
    });
    expect(deriveExitType(trade)).toBe('manual_early');
  });

  it('falls back to R sign when no close price', () => {
    expect(
      deriveExitType(makeTradeRecord({ closedPrice: null, rMultiple: 1.5 })),
    ).toBe('manual_early');
    expect(
      deriveExitType(makeTradeRecord({ closedPrice: null, rMultiple: -1 })),
    ).toBe('stopped_out');
  });
});

describe('scoreExecution', () => {
  it('objective trigger + logical stop + target_hit → 100 overall', () => {
    const g = scoreExecution(makeTradeRecord(), makeChecklist());
    expect(g.entryQuality.score).toBe(100);
    expect(g.stopQuality.score).toBe(100);
    expect(g.stopQuality.logic).toBe('logical');
    expect(g.exitQuality.score).toBe(100);
    expect(g.exitQuality.exitType).toBe('target_hit');
    expect(g.overallExecutionScore).toBe(100);
  });

  it('subjective (market) entry scores 67 on entry (20/30)', () => {
    const g = scoreExecution(
      makeTradeRecord(),
      makeChecklist({ entryTrigger: { type: 'market' } }),
    );
    expect(g.entryQuality.score).toBe(67);
  });

  it('arbitrary stop scores 0 on the stop dimension', () => {
    const g = scoreExecution(
      makeTradeRecord(),
      makeChecklist({ stopPlacement: { logic: 'arbitrary' } }),
    );
    expect(g.stopQuality.score).toBe(0);
  });

  it('widened stop is capped at a positive partial (67), never below 0', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.18,
          reason: 'x',
        },
      ],
    });
    const g = scoreExecution(trade, makeChecklist());
    expect(g.stopQuality.logic).toBe('widened');
    expect(g.stopQuality.score).toBe(67);
    expect(g.stopQuality.score).toBeGreaterThanOrEqual(0);
  });

  it('manual_early exit scores 38 (15/40)', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.21,
      rMultiple: 1,
    });
    const g = scoreExecution(trade, makeChecklist());
    expect(g.exitQuality.exitType).toBe('manual_early');
    expect(g.exitQuality.score).toBe(38);
  });

  it('manual_late exit scores 0', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.185,
      rMultiple: -1.5,
      stopAdjustments: [
        {
          ts: '2026-06-01T11:00:00Z',
          oldStop: 1.19,
          newStop: 1.18,
          reason: 'x',
        },
      ],
    });
    const g = scoreExecution(trade, makeChecklist());
    expect(g.exitQuality.exitType).toBe('manual_late');
    expect(g.exitQuality.score).toBe(0);
  });

  it('clean stopped_out scores 100 on exit (loss is variance)', () => {
    const trade = makeTradeRecord({
      direction: 'long',
      takeProfit: 1.22,
      stopLoss: 1.19,
      closedPrice: 1.19,
      rMultiple: -1,
    });
    const g = scoreExecution(trade, makeChecklist());
    expect(g.exitQuality.exitType).toBe('stopped_out');
    expect(g.exitQuality.score).toBe(100);
  });
});
