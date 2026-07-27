import {
  buildBehavioralReport,
  computeStats,
  DEFAULT_PERIOD_DAYS,
  filterToWindow,
  pickTopPriority,
} from './report';
import { makeEvaluatedTrade } from './test-fixtures';
import { EvaluatedTrade } from './types';

const NOW = new Date('2026-09-01T00:00:00.000Z');

function tradeOn(id: string, closedAt: string, over = {}): EvaluatedTrade {
  return makeEvaluatedTrade({
    tradeId: id,
    trade: { closedAt, openedAt: closedAt, ...over },
  });
}

describe('filterToWindow', () => {
  it('keeps trades within the rolling window and drops older ones', () => {
    const trades = [
      tradeOn('recent', '2026-08-20T00:00:00.000Z'),
      tradeOn('old', '2026-01-01T00:00:00.000Z'),
    ];
    const kept = filterToWindow(trades, 90, NOW);
    expect(kept.map((t) => t.tradeId)).toEqual(['recent']);
  });
});

describe('computeStats', () => {
  it('returns zeroed stats for an empty set', () => {
    const s = computeStats([]);
    expect(s.avgProcessScore).toBe(0);
    expect(s.avgPlanAdherence).toBeNull();
    expect(s.bestProcessScore).toBe(0);
  });

  it('computes averages, rates and best/worst process score', () => {
    const win = tradeOn('w', '2026-08-01T00:00:00.000Z', { rMultiple: 2 });
    const loss = tradeOn('l', '2026-08-02T00:00:00.000Z', {
      rMultiple: -1,
      closedPrice: 1.19,
    });
    const s = computeStats([win, loss]);
    expect(s.winRate).toBe(0.5);
    expect(s.goodTradeRate).toBeGreaterThan(0);
    expect(s.bestProcessScore).toBeGreaterThanOrEqual(s.worstProcessScore);
    expect(typeof s.avgRMultiple).toBe('number');
  });

  it('avgPlanAdherence is null when no trade had a plan', () => {
    const noPlan = makeEvaluatedTrade({
      tradeId: 'np',
      plan: null,
      trade: { closedAt: '2026-08-01T00:00:00Z' },
    });
    expect(computeStats([noPlan]).avgPlanAdherence).toBeNull();
  });

  it('rewards good_process_loss — a disciplined loser lifts avgProcessScore (Decision #3)', () => {
    const goodLoss = tradeOn('gl', '2026-08-01T00:00:00.000Z', {
      rMultiple: -1,
      closedPrice: 1.19,
    });
    const s = computeStats([goodLoss]);
    // full setup + full adherence + clean stop-out → process score high.
    expect(s.avgProcessScore).toBeGreaterThanOrEqual(65);
  });
});

describe('pickTopPriority', () => {
  it('null when no patterns', () => {
    expect(pickTopPriority([])).toBeNull();
  });
});

describe('buildBehavioralReport', () => {
  it('summary is always null at the engine boundary (filled async later)', () => {
    const report = buildBehavioralReport(
      'user-1',
      [tradeOn('a', '2026-08-01T00:00:00Z')],
      { now: NOW },
    );
    expect(report.summary).toBeNull();
  });

  it('defaults to a 90-day window', () => {
    const report = buildBehavioralReport('user-1', [], { now: NOW });
    expect(report.periodDays).toBe(DEFAULT_PERIOD_DAYS);
    expect(DEFAULT_PERIOD_DAYS).toBe(90);
  });

  it('patterns empty below 10 trades; stats still computed', () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      tradeOn(`t${i}`, `2026-08-0${i + 1}T00:00:00Z`),
    );
    const report = buildBehavioralReport('user-1', trades, { now: NOW });
    expect(report.patterns).toEqual([]);
    expect(report.topPriority).toBeNull();
    expect(report.tradesAnalyzed).toBe(5);
    expect(report.stats.avgSetupQuality).toBeGreaterThan(0);
  });

  it('surfaces patterns and a topPriority at 10+ qualifying trades', () => {
    const trades = Array.from({ length: 10 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return makeEvaluatedTrade({
        tradeId: `weak-${i}`,
        checklist: {
          momentum: { higherTfDirection: 'unclear' },
          pattern: { identified: false },
          priceZone: { atSignificantLevel: false },
          timeConfluence: { inTimeZone: false },
          entryTrigger: { type: 'market' },
        },
        trade: {
          openedAt: `2026-08-${day}T10:00:00Z`,
          closedAt: `2026-08-${day}T12:00:00Z`,
        },
      });
    });
    const report = buildBehavioralReport('user-1', trades, { now: NOW });
    expect(report.patterns.length).toBeGreaterThan(0);
    expect(report.topPriority).not.toBeNull();
  });
});
