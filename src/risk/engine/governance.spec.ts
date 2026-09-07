import {
  checkCircuitBreaker,
  checkCorrelatedExposure,
  checkRule,
  deriveOverallStatus,
  evaluateGovernance,
} from './governance';
import {
  DrawdownState,
  PortfolioSnapshot,
  RiskCalculation,
  RiskProfile,
} from './types';

const profile: RiskProfile = {
  maxRiskPerTradePct: 1,
  maxPortfolioExposurePct: 3,
  maxDailyDrawdownPct: 5,
  maxWeeklyDrawdownPct: 8,
  maxMonthlyDrawdownPct: 10,
  maxOpenTrades: 5,
  maxCorrelatedExposure: 6,
  accountBalance: 10000,
  accountCurrency: 'USD',
};

const emptyPortfolio: PortfolioSnapshot = {
  openTradeCount: 0,
  totalCapitalExposurePct: 0,
  totalCapitalExposure: 0,
  openTrades: [],
};

const noDrawdown: DrawdownState = {
  accountBalance: 10000,
  peakBalance: 10000,
  dailyOpenBalance: 10000,
  weeklyOpenBalance: 10000,
  monthlyOpenBalance: 10000,
  drawdownPct: { daily: 0, weekly: 0, monthly: 0, allTime: 0 },
  circuitBreakers: {
    dailyBreached: false,
    weeklyBreached: false,
    monthlyBreached: false,
  },
};

const baseCalc: RiskCalculation = {
  pair: 'EURUSD',
  instrument: 'forex',
  direction: 'long',
  entryPrice: 1.1,
  stopPrice: 1.095,
  targetPrice: null,
  stopDistancePips: 50,
  pipValue: 10,
  pipSize: 0.0001,
  maxCapitalExposure: 100,
  lotSize: 0.2,
  recommendedLotSizeRounded: 0.2,
  lotSizeRounded: 0.2,
  actualCapitalExposure: 100,
  capitalExposurePct: 1,
  rewardPips: null,
  rewardToRisk: null,
};

describe('checkRule thresholds', () => {
  it('blocks at or above the limit', () => {
    expect(checkRule('r', 1.0, 1.0, 'm').status).toBe('blocked');
    expect(checkRule('r', 1.2, 1.0, 'm').status).toBe('blocked');
  });
  it('warns at or above 80% of the limit', () => {
    expect(checkRule('r', 0.8, 1.0, 'm').status).toBe('warning');
    expect(checkRule('r', 0.85, 1.0, 'm').status).toBe('warning');
  });
  it('approves below 80% of the limit', () => {
    expect(checkRule('r', 0.5, 1.0, 'm').status).toBe('approved');
  });
});

describe('checkCircuitBreaker', () => {
  it('blocks once the period has been breached, even when current is low', () => {
    expect(checkCircuitBreaker('d', 2, 5, true, 'm').status).toBe('blocked');
  });
  it('blocks at or above the limit', () => {
    expect(checkCircuitBreaker('d', 5, 5, false, 'm').status).toBe('blocked');
  });
  it('warns at 80% and approves below', () => {
    expect(checkCircuitBreaker('d', 4.5, 5, false, 'm').status).toBe('warning');
    expect(checkCircuitBreaker('d', 2, 5, false, 'm').status).toBe('approved');
  });
});

describe('deriveOverallStatus', () => {
  it('returns the worst status present', () => {
    expect(
      deriveOverallStatus([
        { rule: 'a', status: 'approved', actual: 0, limit: 1, message: '' },
        { rule: 'b', status: 'warning', actual: 0, limit: 1, message: '' },
        { rule: 'c', status: 'blocked', actual: 0, limit: 1, message: '' },
      ]),
    ).toBe('blocked');
    expect(
      deriveOverallStatus([
        { rule: 'a', status: 'approved', actual: 0, limit: 1, message: '' },
        { rule: 'b', status: 'warning', actual: 0, limit: 1, message: '' },
      ]),
    ).toBe('warning');
    expect(
      deriveOverallStatus([
        { rule: 'a', status: 'approved', actual: 0, limit: 1, message: '' },
      ]),
    ).toBe('approved');
  });

  it('ignores informational checks', () => {
    expect(
      deriveOverallStatus([
        {
          rule: 'info',
          status: 'blocked',
          actual: 2,
          limit: 1,
          message: '',
          informational: true,
        },
        { rule: 'a', status: 'approved', actual: 0, limit: 1, message: '' },
      ]),
    ).toBe('approved');
  });
});

describe('checkCorrelatedExposure', () => {
  it('sums same-direction correlated exposure plus this trade', () => {
    const portfolio: PortfolioSnapshot = {
      ...emptyPortfolio,
      openTradeCount: 1,
      openTrades: [
        { tradeId: 't1', pair: 'GBPUSD', direction: 'long', exposurePct: 5 },
      ],
    };
    // EURUSD & GBPUSD share USD_NEGATIVE; both long → 5 + 1 = 6 ≥ limit 6 → blocked
    expect(checkCorrelatedExposure(baseCalc, portfolio, profile).status).toBe(
      'blocked',
    );
  });

  it('ignores opposite-direction correlated trades', () => {
    const portfolio: PortfolioSnapshot = {
      ...emptyPortfolio,
      openTradeCount: 1,
      openTrades: [
        { tradeId: 't1', pair: 'GBPUSD', direction: 'short', exposurePct: 5 },
      ],
    };
    // opposite direction → only this trade's 1% counts → approved
    expect(checkCorrelatedExposure(baseCalc, portfolio, profile).status).toBe(
      'approved',
    );
  });
});

describe('evaluateGovernance', () => {
  it('approves a sub-limit trade against defaults', () => {
    // Floor-rounded sizing normally lands just under the limit; a trade at
    // exactly the per-trade limit blocks (actual >= limit), covered below.
    const calc = {
      ...baseCalc,
      capitalExposurePct: 0.5,
      actualCapitalExposure: 50,
    };
    const result = evaluateGovernance(
      calc,
      emptyPortfolio,
      noDrawdown,
      profile,
    );
    expect(result.overallStatus).toBe('approved');
    expect(result.blockedReason).toBeNull();
    expect(result.aiCoaching).toBeNull();
  });

  it('marks the per-trade check informational and does not let it gate the trade', () => {
    // baseCalc.capitalExposurePct === maxRiskPerTradePct === 1: the per-trade
    // check is 'blocked' in isolation, but informational → overall approved.
    const result = evaluateGovernance(
      baseCalc,
      emptyPortfolio,
      noDrawdown,
      profile,
    );
    const perTrade = result.checks.find((c) => c.rule === 'maxRiskPerTrade');
    expect(perTrade?.informational).toBe(true);
    expect(perTrade?.status).toBe('blocked'); // still computed for display
    expect(result.overallStatus).toBe('approved'); // but never gates
    expect(result.blockedReason).toBeNull();
  });

  it('blocks new trades when the daily circuit breaker is already breached', () => {
    const drawdown: DrawdownState = {
      ...noDrawdown,
      drawdownPct: { ...noDrawdown.drawdownPct, daily: 1 },
      circuitBreakers: { ...noDrawdown.circuitBreakers, dailyBreached: true },
    };
    const calc = { ...baseCalc, capitalExposurePct: 0.5 };
    const result = evaluateGovernance(calc, emptyPortfolio, drawdown, profile);
    expect(result.overallStatus).toBe('blocked');
  });

  it('warns (never blocks) on sub-2:1 reward-to-risk', () => {
    const calc = { ...baseCalc, capitalExposurePct: 0.5, rewardToRisk: 1.5 };
    const result = evaluateGovernance(
      calc,
      emptyPortfolio,
      noDrawdown,
      profile,
    );
    const rr = result.checks.find((c) => c.rule === 'minRewardToRisk');
    expect(rr?.status).toBe('warning');
    expect(result.overallStatus).toBe('warning');
  });

  it('omits the reward-to-risk check when no target was provided', () => {
    const result = evaluateGovernance(
      baseCalc,
      emptyPortfolio,
      noDrawdown,
      profile,
    );
    expect(
      result.checks.find((c) => c.rule === 'minRewardToRisk'),
    ).toBeUndefined();
  });

  it('localizes check messages by language (en default, fr)', () => {
    const en = evaluateGovernance(
      baseCalc,
      emptyPortfolio,
      noDrawdown,
      profile,
    );
    const fr = evaluateGovernance(
      baseCalc,
      emptyPortfolio,
      noDrawdown,
      profile,
      'fr',
    );
    const enMsg = en.checks.find((c) => c.rule === 'maxOpenTrades')?.message;
    const frMsg = fr.checks.find((c) => c.rule === 'maxOpenTrades')?.message;
    expect(enMsg).toBe('Open trade count');
    expect(frMsg).toBe('Nombre de trades ouverts');
  });

  it('localizes the blockedReason', () => {
    // Force a portfolio block so there is a (non-informational) blockedReason.
    const portfolio: PortfolioSnapshot = {
      ...emptyPortfolio,
      totalCapitalExposurePct: 3,
    };
    const calc = { ...baseCalc, capitalExposurePct: 0.5 };
    const fr = evaluateGovernance(calc, portfolio, noDrawdown, profile, 'fr');
    expect(fr.overallStatus).toBe('blocked');
    expect(fr.blockedReason).toBe(
      'Exposition totale du portefeuille après ce trade',
    );
  });
});
