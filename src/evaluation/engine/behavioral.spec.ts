import {
  detectAll,
  detectChasingEntries,
  detectEarlyExit,
  detectInconsistentSizing,
  detectLuckyStreak,
  detectOvertrading,
  detectRevengeTrading,
  detectRuleBreakingStreak,
  detectStopWidening,
  detectWeakSetupBias,
  MIN_EVALUATED_TRADES,
} from './behavioral';
import { EvaluatedTrade } from './types';
import { makeEvaluatedTrade } from './test-fixtures';

/** Build N baseline (clean, good-process) evaluated trades on distinct days. */
function cleanTrades(n: number): EvaluatedTrade[] {
  return Array.from({ length: n }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return makeEvaluatedTrade({
      tradeId: `clean-${i}`,
      trade: {
        openedAt: `2026-06-${day}T10:00:00.000Z`,
        closedAt: `2026-06-${day}T12:00:00.000Z`,
      },
    });
  });
}

describe('global 10-trade gate (detectAll)', () => {
  it('returns no patterns below MIN_EVALUATED_TRADES even if a detector would fire', () => {
    // 9 trades that would otherwise trigger weak_setup_bias.
    const trades = Array.from({ length: 9 }, (_, i) =>
      makeEvaluatedTrade({
        tradeId: `weak-${i}`,
        checklist: {
          momentum: { higherTfDirection: 'unclear' },
          pattern: { identified: false },
        },
        trade: {
          openedAt: `2026-06-0${i + 1}T10:00:00Z`,
          closedAt: `2026-06-0${i + 1}T12:00:00Z`,
        },
      }),
    );
    expect(trades.length).toBeLessThan(MIN_EVALUATED_TRADES);
    expect(detectAll(trades)).toEqual([]);
  });

  it('runs detectors at exactly 10 trades', () => {
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
          openedAt: `2026-06-${day}T10:00:00Z`,
          closedAt: `2026-06-${day}T12:00:00Z`,
        },
      });
    });
    const patterns = detectAll(trades);
    expect(patterns.find((p) => p.type === 'weak_setup_bias')).toBeDefined();
  });
});

describe('detectEarlyExit', () => {
  function winning(
    exitType: 'manual_early' | 'target_hit',
    id: string,
  ): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: {
        rMultiple: 1,
        takeProfit: 1.22,
        closedPrice: exitType === 'target_hit' ? 1.22 : 1.21,
      },
    });
  }

  it('null below the 5-winner sample floor', () => {
    const trades = [winning('manual_early', 'a'), winning('manual_early', 'b')];
    expect(detectEarlyExit(trades)).toBeNull();
  });

  it('null at exactly 40% rate (just below the >40% trigger? boundary is < 0.40)', () => {
    // 2 of 5 early = 0.40, which is NOT < 0.40 → fires. Use 1 of 5 = 0.20.
    const trades = [
      winning('manual_early', 'a'),
      winning('target_hit', 'b'),
      winning('target_hit', 'c'),
      winning('target_hit', 'd'),
      winning('target_hit', 'e'),
    ];
    expect(detectEarlyExit(trades)).toBeNull();
  });

  it('fires at 40% (2 of 5), severity warning', () => {
    const trades = [
      winning('manual_early', 'a'),
      winning('manual_early', 'b'),
      winning('target_hit', 'c'),
      winning('target_hit', 'd'),
      winning('target_hit', 'e'),
    ];
    const p = detectEarlyExit(trades)!;
    expect(p.type).toBe('early_exit');
    expect(p.severity).toBe('warning');
    expect(p.sampleSize).toBe(2);
    expect(p.totalTrades).toBe(5);
  });

  it('critical above 60%', () => {
    const trades = [
      winning('manual_early', 'a'),
      winning('manual_early', 'b'),
      winning('manual_early', 'c'),
      winning('manual_early', 'd'),
      winning('target_hit', 'e'),
    ];
    const p = detectEarlyExit(trades)!; // 4/5 = 0.8
    expect(p.severity).toBe('critical');
  });
});

describe('detectRevengeTrading', () => {
  // A loss then trades within 4h with poor adherence.
  function trade(
    id: string,
    opts: {
      openedAt: string;
      closedAt: string;
      rMultiple: number;
      adherence?: number;
      skipped?: boolean;
    },
  ): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: {
        openedAt: opts.openedAt,
        closedAt: opts.closedAt,
        rMultiple: opts.rMultiple,
        closedPrice: opts.rMultiple < 0 ? 1.19 : 1.22,
      },
      // Drop adherence by removing a required pattern when low adherence is desired.
      checklist:
        opts.adherence === 0
          ? {
              momentum: {
                higherTfDirection: 'unclear',
                lowerTfReversal: false,
              },
              pattern: { identified: false },
              priceZone: { atSignificantLevel: false },
              stopPlacement: { logic: 'arbitrary' },
            }
          : {},
      checklistSkipped: opts.skipped ?? false,
    });
  }

  it('null with fewer than 3 post-loss trades', () => {
    const trades = [
      trade('loss', {
        openedAt: '2026-06-01T08:00:00Z',
        closedAt: '2026-06-01T09:00:00Z',
        rMultiple: -1,
      }),
      trade('post', {
        openedAt: '2026-06-01T10:00:00Z',
        closedAt: '2026-06-01T11:00:00Z',
        rMultiple: -1,
        adherence: 0,
      }),
    ];
    expect(detectRevengeTrading(trades)).toBeNull();
  });

  it('fires when adherence drops >20 pts in the 4h after losses (skip = adherence 0)', () => {
    // 3 good baseline winners (high adherence) then 3 post-loss skipped trades.
    const baseline = Array.from({ length: 3 }, (_, i) =>
      trade(`good-${i}`, {
        openedAt: `2026-06-1${i}T08:00:00Z`,
        closedAt: `2026-06-1${i}T09:00:00Z`,
        rMultiple: 2,
      }),
    );
    const loss = trade('L', {
      openedAt: '2026-06-20T08:00:00Z',
      closedAt: '2026-06-20T09:00:00Z',
      rMultiple: -1,
    });
    const revenge = [
      trade('r1', {
        openedAt: '2026-06-20T10:00:00Z',
        closedAt: '2026-06-20T11:00:00Z',
        rMultiple: -1,
        skipped: true,
      }),
      trade('r2', {
        openedAt: '2026-06-20T11:30:00Z',
        closedAt: '2026-06-20T12:00:00Z',
        rMultiple: -1,
        skipped: true,
      }),
      trade('r3', {
        openedAt: '2026-06-20T12:30:00Z',
        closedAt: '2026-06-20T13:00:00Z',
        rMultiple: -1,
        skipped: true,
      }),
    ];
    // r2/r3 follow another loss within 4h; r1 follows L.
    const p = detectRevengeTrading([...baseline, loss, ...revenge])!;
    expect(p.type).toBe('revenge_trading');
    expect(p.severity).toBe('critical');
    expect(p.sampleSize).toBeGreaterThanOrEqual(3);
  });
});

describe('detectLuckyStreak', () => {
  function lucky(id: string, openedAt: string): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: { openedAt, rMultiple: 2 },
      verdictOverride: { lucky: true, matrix: 'bad_process_win' },
    });
  }
  function normal(id: string, openedAt: string): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: { openedAt, rMultiple: 2 },
    });
  }

  it('null below 3 consecutive lucky trades', () => {
    const trades = [
      lucky('a', '2026-06-01T10:00:00Z'),
      normal('b', '2026-06-02T10:00:00Z'),
      lucky('c', '2026-06-03T10:00:00Z'),
      lucky('d', '2026-06-04T10:00:00Z'),
    ];
    expect(detectLuckyStreak(trades)).toBeNull();
  });

  it('fires at exactly 3 consecutive lucky trades', () => {
    const trades = [
      normal('a', '2026-06-01T10:00:00Z'),
      lucky('b', '2026-06-02T10:00:00Z'),
      lucky('c', '2026-06-03T10:00:00Z'),
      lucky('d', '2026-06-04T10:00:00Z'),
    ];
    const p = detectLuckyStreak(trades)!;
    expect(p.type).toBe('lucky_streak');
    expect(p.sampleSize).toBe(3);
    expect(p.evidence).toEqual(['b', 'c', 'd']);
  });
});

describe('detectInconsistentSizing', () => {
  function sized(
    id: string,
    actual: number,
    suggested: number | null,
  ): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: { actualLotSize: actual, suggestedLotSize: suggested },
    });
  }

  it('null when fewer than 4 deviating trades even above 30% rate', () => {
    const trades = [
      sized('a', 2, 1), // 100% deviation
      sized('b', 2, 1),
      sized('c', 2, 1),
      sized('d', 1, 1),
      sized('e', 1, 1),
      sized('f', 1, 1),
    ];
    // 3 of 6 = 50% rate but only 3 deviations < 4 → null
    expect(detectInconsistentSizing(trades)).toBeNull();
  });

  it('fires when >=30% and >=4 deviate beyond 20%', () => {
    const trades = [
      sized('a', 2, 1),
      sized('b', 2, 1),
      sized('c', 2, 1),
      sized('d', 2, 1),
      sized('e', 1, 1),
      sized('f', 1, 1),
    ];
    const p = detectInconsistentSizing(trades)!; // 4 of 6 ≈ 0.67
    expect(p.type).toBe('inconsistent_sizing');
    expect(p.severity).toBe('warning');
    expect(p.sampleSize).toBe(4);
  });

  it('ignores trades with no suggested lot size', () => {
    const trades = [
      sized('a', 5, null),
      sized('b', 5, null),
      sized('c', 5, null),
      sized('d', 5, null),
    ];
    expect(detectInconsistentSizing(trades)).toBeNull();
  });

  it('exactly 20% deviation does NOT count (must be > 20%)', () => {
    const trades = [
      sized('a', 1.2, 1), // exactly 20%
      sized('b', 1.2, 1),
      sized('c', 1.2, 1),
      sized('d', 1.2, 1),
    ];
    expect(detectInconsistentSizing(trades)).toBeNull();
  });
});

describe('detectOvertrading', () => {
  function onDay(id: string, day: string): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: {
        openedAt: `2026-06-${day}T10:00:00Z`,
        closedAt: `2026-06-${day}T12:00:00Z`,
      },
    });
  }

  it('null when no daily limit (maxTradesPerDay = 0)', () => {
    const trades = [onDay('a', '01'), onDay('b', '01'), onDay('c', '01')];
    expect(detectOvertrading(trades, 0)).toBeNull();
  });

  it('null below 3 active days', () => {
    const trades = [onDay('a', '01'), onDay('b', '01'), onDay('c', '01')];
    expect(detectOvertrading(trades, 1)).toBeNull(); // only 1 active day
  });

  it('null when exceeded-day rate < 30%', () => {
    // 4 active days, limit 2; exceed on 1 day → 25% < 30%.
    const trades = [
      onDay('a', '01'),
      onDay('a2', '01'),
      onDay('a3', '01'), // day1 = 3 (exceeds)
      onDay('b', '02'),
      onDay('c', '03'),
      onDay('d', '04'),
    ];
    expect(detectOvertrading(trades, 2)).toBeNull();
  });

  it('fires when exceeded-day rate >= 30% (limit 2)', () => {
    // 3 active days, exceed on 1 → 33% >= 30%.
    const trades = [
      onDay('a', '01'),
      onDay('a2', '01'),
      onDay('a3', '01'), // exceeds 2
      onDay('b', '02'),
      onDay('c', '03'),
    ];
    const p = detectOvertrading(trades, 2)!;
    expect(p.type).toBe('overtrading');
    expect(p.sampleSize).toBe(1);
  });
});

describe('detectStopWidening', () => {
  function widened(id: string): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: {
        direction: 'long',
        stopAdjustments: [
          {
            ts: '2026-06-01T11:00:00Z',
            oldStop: 1.19,
            newStop: 1.18,
            reason: 'x',
          },
        ],
      },
    });
  }

  it('null with only 1 widened trade', () => {
    expect(
      detectStopWidening([widened('a'), makeEvaluatedTrade({ tradeId: 'b' })]),
    ).toBeNull();
  });

  it('fires at 2 widened trades', () => {
    const p = detectStopWidening([
      widened('a'),
      widened('b'),
      makeEvaluatedTrade({ tradeId: 'c' }),
    ])!;
    expect(p.type).toBe('stop_widening');
    expect(p.sampleSize).toBe(2);
    expect(p.severity).toBe('warning');
  });

  it('critical at 4+ widened trades', () => {
    const p = detectStopWidening([
      widened('a'),
      widened('b'),
      widened('c'),
      widened('d'),
    ])!;
    expect(p.severity).toBe('critical');
  });
});

describe('detectRuleBreakingStreak', () => {
  function broke(id: string, openedAt: string): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      trade: { openedAt },
      // major violation: required pattern absent.
      checklist: { pattern: { identified: false } },
    });
  }
  function clean(id: string, openedAt: string): EvaluatedTrade {
    return makeEvaluatedTrade({ tradeId: id, trade: { openedAt } });
  }

  it('null below 3 consecutive breaks', () => {
    const trades = [
      broke('a', '2026-06-01T10:00:00Z'),
      broke('b', '2026-06-02T10:00:00Z'),
      clean('c', '2026-06-03T10:00:00Z'),
    ];
    expect(detectRuleBreakingStreak(trades)).toBeNull();
  });

  it('fires at 3 consecutive breaks', () => {
    const trades = [
      clean('z', '2026-06-01T10:00:00Z'),
      broke('a', '2026-06-02T10:00:00Z'),
      broke('b', '2026-06-03T10:00:00Z'),
      broke('c', '2026-06-04T10:00:00Z'),
    ];
    const p = detectRuleBreakingStreak(trades)!;
    expect(p.type).toBe('rule_breaking_streak');
    expect(p.sampleSize).toBe(3);
    expect(p.evidence).toEqual(['a', 'b', 'c']);
  });

  it('a skipped checklist counts as a rule break (Decision #2)', () => {
    const trades = [
      makeEvaluatedTrade({
        tradeId: 'a',
        trade: { openedAt: '2026-06-01T10:00:00Z' },
        checklistSkipped: true,
      }),
      makeEvaluatedTrade({
        tradeId: 'b',
        trade: { openedAt: '2026-06-02T10:00:00Z' },
        checklistSkipped: true,
      }),
      makeEvaluatedTrade({
        tradeId: 'c',
        trade: { openedAt: '2026-06-03T10:00:00Z' },
        checklistSkipped: true,
      }),
    ];
    expect(detectRuleBreakingStreak(trades)?.sampleSize).toBe(3);
  });
});

describe('detectChasingEntries', () => {
  // entryQuality.planned must be objective; score < 100 marks a chase.
  function chase(id: string, score: number): EvaluatedTrade {
    return makeEvaluatedTrade({
      tradeId: id,
      execGradeOverride: {
        entryQuality: { planned: 'trailing_1BH', score },
      },
    });
  }

  it('null below 5 objective-trigger trades', () => {
    const trades = [
      chase('a', 50),
      chase('b', 50),
      chase('c', 50),
      chase('d', 50),
    ];
    expect(detectChasingEntries(trades)).toBeNull();
  });

  it('null when chase rate is at/below 40%', () => {
    // 2 of 5 chased = 40% → not > 40%.
    const trades = [
      chase('a', 50),
      chase('b', 50),
      chase('c', 100),
      chase('d', 100),
      chase('e', 100),
    ];
    expect(detectChasingEntries(trades)).toBeNull();
  });

  it('fires (warning) when >40% but <=60% of objective entries are chased', () => {
    // 3 of 5 = 60% → warning (not > 0.6).
    const trades = [
      chase('a', 50),
      chase('b', 50),
      chase('c', 50),
      chase('d', 100),
      chase('e', 100),
    ];
    const p = detectChasingEntries(trades)!;
    expect(p.type).toBe('chasing_entries');
    expect(p.severity).toBe('warning');
    expect(p.sampleSize).toBe(3);
  });

  it('critical when >60% of objective entries are chased', () => {
    // 4 of 5 = 80%.
    const trades = [
      chase('a', 50),
      chase('b', 50),
      chase('c', 50),
      chase('d', 50),
      chase('e', 100),
    ];
    expect(detectChasingEntries(trades)!.severity).toBe('critical');
  });
});

describe('detectWeakSetupBias', () => {
  function setup(id: string, total: number): EvaluatedTrade {
    // Drive setup quality down via the checklist.
    if (total >= 55) {
      return makeEvaluatedTrade({ tradeId: id }); // 100
    }
    return makeEvaluatedTrade({
      tradeId: id,
      checklist: {
        momentum: { higherTfDirection: 'unclear' },
        pattern: { identified: false },
        priceZone: { atSignificantLevel: false },
        timeConfluence: { inTimeZone: false },
        entryTrigger: { type: 'market' },
      },
    });
  }

  it('null below 8 trades', () => {
    const trades = Array.from({ length: 7 }, (_, i) => setup(`w${i}`, 0));
    expect(detectWeakSetupBias(trades)).toBeNull();
  });

  it('null when weak rate is at/below 50%', () => {
    const trades = [
      ...Array.from({ length: 4 }, (_, i) => setup(`w${i}`, 0)),
      ...Array.from({ length: 4 }, (_, i) => setup(`s${i}`, 100)),
    ];
    expect(detectWeakSetupBias(trades)).toBeNull();
  });

  it('fires when >50% of trades score below 55', () => {
    const trades = [
      ...Array.from({ length: 5 }, (_, i) => setup(`w${i}`, 0)),
      ...Array.from({ length: 3 }, (_, i) => setup(`s${i}`, 100)),
    ];
    const p = detectWeakSetupBias(trades)!;
    expect(p.type).toBe('weak_setup_bias');
    expect(p.sampleSize).toBe(5);
  });
});

describe('detectAll sorting', () => {
  it('returns critical patterns before warnings', () => {
    const patterns = detectAll([
      ...cleanTrades(7),
      // 3 lucky in a row (critical)
      makeEvaluatedTrade({
        tradeId: 'l1',
        trade: {
          openedAt: '2026-06-21T10:00:00Z',
          closedAt: '2026-06-21T12:00:00Z',
          rMultiple: 2,
        },
        verdictOverride: { lucky: true },
      }),
      makeEvaluatedTrade({
        tradeId: 'l2',
        trade: {
          openedAt: '2026-06-22T10:00:00Z',
          closedAt: '2026-06-22T12:00:00Z',
          rMultiple: 2,
        },
        verdictOverride: { lucky: true },
      }),
      makeEvaluatedTrade({
        tradeId: 'l3',
        trade: {
          openedAt: '2026-06-23T10:00:00Z',
          closedAt: '2026-06-23T12:00:00Z',
          rMultiple: 2,
        },
        verdictOverride: { lucky: true },
      }),
    ]);
    if (patterns.length > 1) {
      expect(patterns[0].severity).toBe('critical');
    }
    expect(patterns.find((p) => p.type === 'lucky_streak')).toBeDefined();
  });
});
