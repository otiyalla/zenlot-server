import {
  calculateDrawdown,
  calculatePnL,
  calculatePositionSize,
  calculateRewardToRisk,
  calculateRMultiple,
  computeRiskCalculation,
  floorToStep,
  RiskCalculationError,
} from './calculations';
import { getPipSize } from './instruments';

describe('floorToStep', () => {
  it('rounds down to the nearest step and never up', () => {
    expect(floorToStep(0.2799, 0.01)).toBeCloseTo(0.27, 10);
    expect(floorToStep(0.2, 0.01)).toBeCloseTo(0.2, 10);
    expect(floorToStep(0.999, 0.01)).toBeCloseTo(0.99, 10);
  });

  it('absorbs binary float error (0.07 / 0.01)', () => {
    expect(floorToStep(0.07, 0.01)).toBeCloseTo(0.07, 10);
  });

  it('returns the value unchanged for a non-positive step', () => {
    expect(floorToStep(1.234, 0)).toBe(1.234);
  });
});

describe('calculatePositionSize — forex pip-value cases (spec Section 13.2)', () => {
  const base = {
    accountBalance: 10000,
    maxRiskPct: 1,
    pipSize: 0.0001,
    contractSize: 100000,
  };

  it('Case 1: quote === account (EURUSD/USD) → $10 pip value, exact 1% exposure', () => {
    const r = calculatePositionSize({
      ...base,
      entryPrice: 1.1,
      stopPrice: 1.095,
      exchangeRate: 1,
    });
    expect(r.pipValue).toBeCloseTo(10, 6);
    expect(r.stopDistancePips).toBeCloseTo(50, 6);
    expect(r.lotSize).toBeCloseTo(0.2, 6);
    expect(r.lotSizeRounded).toBeCloseTo(0.2, 6);
    expect(r.actualCapitalExposure).toBeCloseTo(100, 6);
    expect(r.capitalExposurePct).toBeCloseTo(1, 6);
  });

  it('Case 2: base === account (USDCAD/USD @1.36) → ~$7.35 pip value', () => {
    const r = calculatePositionSize({
      ...base,
      entryPrice: 1.36,
      stopPrice: 1.355,
      exchangeRate: 1 / 1.36, // CAD → USD
    });
    expect(r.pipValue).toBeCloseTo(7.3529, 3);
  });

  it('Case 3: cross (EURGBP/USD, GBPUSD=1.27) → $12.70 pip value', () => {
    const r = calculatePositionSize({
      ...base,
      entryPrice: 0.86,
      stopPrice: 0.855,
      exchangeRate: 1.27, // GBP → USD
    });
    expect(r.pipValue).toBeCloseTo(12.7, 6);
  });

  it('rounds the lot DOWN so actual exposure never exceeds the cap', () => {
    const r = calculatePositionSize({
      ...base,
      entryPrice: 1.1,
      stopPrice: 1.0963, // 37 pip stop → raw lot 0.27027
      exchangeRate: 1,
    });
    expect(r.lotSize).toBeCloseTo(0.27027, 4);
    expect(r.lotSizeRounded).toBeCloseTo(0.27, 6);
    expect(r.actualCapitalExposure).toBeLessThanOrEqual(r.maxCapitalExposure);
  });
});

describe('calculatePositionSize — guards', () => {
  const ok = {
    accountBalance: 10000,
    maxRiskPct: 1,
    entryPrice: 1.1,
    stopPrice: 1.095,
    pipSize: 0.0001,
    contractSize: 100000,
    exchangeRate: 1,
  };

  it('throws when entry equals stop', () => {
    expect(() => calculatePositionSize({ ...ok, stopPrice: 1.1 })).toThrow(
      RiskCalculationError,
    );
  });
  it('throws on non-positive balance', () => {
    expect(() => calculatePositionSize({ ...ok, accountBalance: 0 })).toThrow(
      RiskCalculationError,
    );
  });
  it('throws on non-positive risk', () => {
    expect(() => calculatePositionSize({ ...ok, maxRiskPct: 0 })).toThrow(
      RiskCalculationError,
    );
  });
  it('throws on non-positive value-per-lot (bad exchange rate)', () => {
    expect(() => calculatePositionSize({ ...ok, exchangeRate: 0 })).toThrow(
      RiskCalculationError,
    );
  });
});

describe('computeRiskCalculation — multi-instrument', () => {
  it('sizes a forex trade end-to-end with reward fields', () => {
    const calc = computeRiskCalculation({
      pair: 'EURUSD',
      direction: 'long',
      entryPrice: 1.1,
      stopPrice: 1.095,
      targetPrice: 1.11,
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
    });
    expect(calc.instrument).toBe('forex');
    expect(calc.lotSizeRounded).toBeCloseTo(0.2, 6);
    expect(calc.actualCapitalExposure).toBeCloseTo(100, 6);
    expect(calc.rewardPips).toBeCloseTo(100, 6);
    expect(calc.rewardToRisk).toBeCloseTo(2, 6); // 100 reward / 50 risk
  });

  it('sizes a gold trade using the gold contract size (100)', () => {
    const calc = computeRiskCalculation({
      pair: 'XAUUSD',
      direction: 'long',
      entryPrice: 2000,
      stopPrice: 1990, // $10 stop distance
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
    });
    expect(calc.instrument).toBe('gold');
    // lot = 100 / (10 × 100 × 1) = 0.1
    expect(calc.lotSizeRounded).toBeCloseTo(0.1, 6);
    expect(calc.actualCapitalExposure).toBeCloseTo(100, 6);
    expect(calc.rewardToRisk).toBeNull();
  });

  it('detects a bitcoin instrument', () => {
    const calc = computeRiskCalculation({
      pair: 'BTCUSD',
      direction: 'short',
      entryPrice: 60000,
      stopPrice: 61000,
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
    });
    expect(calc.instrument).toBe('bitcoin');
    expect(calc.direction).toBe('short');
  });

  it('honours a user-chosen lot override (keeps the recommendation in lotSize)', () => {
    const calc = computeRiskCalculation({
      pair: 'EURUSD',
      direction: 'long',
      entryPrice: 1.1,
      stopPrice: 1.095, // recommended lot 0.2
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
      lot: 0.05, // trader sizes down
    });
    expect(calc.lotSize).toBeCloseTo(0.2, 6); // engine recommendation preserved
    expect(calc.lotSizeRounded).toBeCloseTo(0.05, 6); // user's chosen size
    // exposure from the chosen lot: 0.05 × 0.005 × 100000 = 25
    expect(calc.actualCapitalExposure).toBeCloseTo(25, 6);
    expect(calc.capitalExposurePct).toBeCloseTo(0.25, 6);
  });

  it('floors a crypto lot override to the 0.001 step', () => {
    const calc = computeRiskCalculation({
      pair: 'BTCUSD',
      direction: 'long',
      entryPrice: 60000,
      stopPrice: 59000,
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
      lot: 0.0027, // → floors to 0.002 at the 0.001 crypto step
    });
    expect(calc.lotSizeRounded).toBeCloseTo(0.002, 6);
  });

  it('leaves reward null when no target is given', () => {
    const calc = computeRiskCalculation({
      pair: 'EURUSD',
      direction: 'long',
      entryPrice: 1.1,
      stopPrice: 1.095,
      accountBalance: 10000,
      maxRiskPct: 1,
      exchangeRate: 1,
    });
    expect(calc.rewardPips).toBeNull();
    expect(calc.rewardToRisk).toBeNull();
  });

  it.each([
    ['long stop above entry', { direction: 'long' as const, stopPrice: 1.105 }],
    [
      'long stop equal to entry',
      { direction: 'long' as const, stopPrice: 1.1 },
    ],
    [
      'long target below entry',
      { direction: 'long' as const, stopPrice: 1.095, targetPrice: 1.09 },
    ],
    [
      'long target equal to entry',
      { direction: 'long' as const, stopPrice: 1.095, targetPrice: 1.1 },
    ],
    [
      'short stop below entry',
      { direction: 'short' as const, stopPrice: 1.095 },
    ],
    [
      'short stop equal to entry',
      { direction: 'short' as const, stopPrice: 1.1 },
    ],
    [
      'short target above entry',
      { direction: 'short' as const, stopPrice: 1.105, targetPrice: 1.11 },
    ],
    [
      'short target equal to entry',
      { direction: 'short' as const, stopPrice: 1.105, targetPrice: 1.1 },
    ],
  ])('rejects invalid geometry: %s', (_label, geometry) => {
    expect(() =>
      computeRiskCalculation({
        pair: 'EURUSD',
        accountBalance: 10000,
        maxRiskPct: 1,
        exchangeRate: 1,
        entryPrice: 1.1,
        ...geometry,
      }),
    ).toThrow(RiskCalculationError);
  });

  it('allows omitted and null targets', () => {
    for (const targetPrice of [undefined, null]) {
      const calc = computeRiskCalculation({
        pair: 'EURUSD',
        direction: 'long',
        entryPrice: 1.1,
        stopPrice: 1.095,
        targetPrice,
        accountBalance: 10000,
        maxRiskPct: 1,
        exchangeRate: 1,
      });
      expect(calc.rewardToRisk).toBeNull();
    }
  });
});

describe('calculateRewardToRisk', () => {
  it('computes reward pips and the ratio', () => {
    const r = calculateRewardToRisk(1.1, 1.095, 1.11, 0.0001);
    expect(r.rewardPips).toBeCloseTo(100, 6);
    expect(r.rewardToRisk).toBeCloseTo(2, 6);
  });
});

describe('calculateRMultiple', () => {
  it('returns +1.0 at one R of profit (long)', () => {
    expect(calculateRMultiple(1.1, 1.11, 1.09, 'long')).toBeCloseTo(1, 6);
  });
  it('returns -1.0 when stopped out (long)', () => {
    expect(calculateRMultiple(1.1, 1.09, 1.09, 'long')).toBeCloseTo(-1, 6);
  });
  it('returns +2.0 for a 2R short winner', () => {
    expect(calculateRMultiple(1.1, 1.08, 1.11, 'short')).toBeCloseTo(2, 6);
  });
  it('throws when entry equals stop', () => {
    expect(() => calculateRMultiple(1.1, 1.2, 1.1, 'long')).toThrow(
      RiskCalculationError,
    );
  });
});

describe('calculatePnL', () => {
  it('is positive for a winning long and negative for a losing long', () => {
    const win = calculatePnL({
      symbol: 'EURUSD',
      entryPrice: 1.1,
      exitPrice: 1.105,
      lotSize: 0.2,
      direction: 'long',
      exchangeRate: 1,
    });
    const loss = calculatePnL({
      symbol: 'EURUSD',
      entryPrice: 1.1,
      exitPrice: 1.095,
      lotSize: 0.2,
      direction: 'long',
      exchangeRate: 1,
    });
    expect(win).toBeCloseTo(100, 6);
    expect(loss).toBeCloseTo(-100, 6);
  });

  it('inverts the sign for shorts', () => {
    const win = calculatePnL({
      symbol: 'EURUSD',
      entryPrice: 1.1,
      exitPrice: 1.095,
      lotSize: 0.2,
      direction: 'short',
      exchangeRate: 1,
    });
    expect(win).toBeCloseTo(100, 6);
  });
});

describe('calculateDrawdown', () => {
  it('computes per-period drawdown and floors gains at 0', () => {
    const dd = calculateDrawdown(9500, 10000, 10000, 10000, 11000);
    expect(dd.daily).toBeCloseTo(5, 6);
    expect(dd.allTime).toBeCloseTo((1500 / 11000) * 100, 6);
  });

  it('returns 0 when the balance is above the open (no negative drawdown)', () => {
    const dd = calculateDrawdown(10500, 10000, 10000, 10000, 10500);
    expect(dd.daily).toBe(0);
    expect(dd.allTime).toBe(0);
  });

  it('returns 0 for a non-positive open balance', () => {
    const dd = calculateDrawdown(9500, 0, 0, 0, 0);
    expect(dd).toEqual({ daily: 0, weekly: 0, monthly: 0, allTime: 0 });
  });
});

describe('getPipSize', () => {
  it('uses 0.01 for JPY pairs and 0.0001 otherwise', () => {
    expect(getPipSize('USDJPY')).toBe(0.01);
    expect(getPipSize('EURUSD')).toBe(0.0001);
  });
});
