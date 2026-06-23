import { buildCoachingPrompt } from './coaching.prompt';
import { CoachingContext } from './coaching.interface';
import { GovernanceResult } from '../engine';
import { RiskCalculationView } from '../risk.mapper';

const calculation: RiskCalculationView = {
  symbol: 'EURUSD',
  execution: 'buy',
  instrument: 'forex',
  entry: 1.1,
  stopPrice: 1.095,
  targetPrice: 1.11,
  exchangeRate: 1,
  stopDistancePips: 50,
  pipValue: 10,
  pipSize: 0.0001,
  maxCapitalExposure: 100,
  lotSize: 0.2,
  lotSizeRounded: 0.2,
  actualCapitalExposure: 100,
  capitalExposurePct: 1,
  rewardPips: 100,
  rewardToRisk: 2,
};

const approvedGov: GovernanceResult = {
  overallStatus: 'approved',
  checks: [
    {
      rule: 'maxRiskPerTrade',
      status: 'blocked',
      actual: 1,
      limit: 1,
      message: 'Capital exposure per trade',
      informational: true,
    },
    {
      rule: 'maxPortfolioExposure',
      status: 'approved',
      actual: 1,
      limit: 3,
      message: 'Total portfolio exposure after this trade',
    },
  ],
  blockedReason: null,
  aiCoaching: null,
};

function ctx(
  governance: GovernanceResult,
  accountCurrency = 'USD',
): CoachingContext {
  return { calculation, governance, accountCurrency };
}

describe('buildCoachingPrompt', () => {
  it('includes the key numbers and the account-currency symbol', () => {
    const { user } = buildCoachingPrompt(ctx(approvedGov), 'en');
    expect(user).toContain('EURUSD buy');
    expect(user).toContain('0.2 lots');
    expect(user).toContain('$100.00');
    expect(user).toContain('Reward-to-risk: 2.00');
  });

  it('uses the correct currency symbol for non-USD accounts', () => {
    const { user } = buildCoachingPrompt(ctx(approvedGov, 'EUR'), 'en');
    expect(user).toContain('€100.00');
  });

  it('leads with the blocking reason when blocked', () => {
    const blocked: GovernanceResult = {
      overallStatus: 'blocked',
      checks: [
        {
          rule: 'maxPortfolioExposure',
          status: 'blocked',
          actual: 3.5,
          limit: 3,
          message: 'Total portfolio exposure after this trade',
        },
      ],
      blockedReason: 'Total portfolio exposure after this trade',
      aiCoaching: null,
    };
    const { user } = buildCoachingPrompt(ctx(blocked), 'en');
    expect(
      user.startsWith('BLOCKED: Total portfolio exposure after this trade'),
    ).toBe(true);
  });

  it('excludes informational checks from "needs attention"', () => {
    const { user } = buildCoachingPrompt(ctx(approvedGov), 'en');
    // maxRiskPerTrade is informational+blocked but must not appear as needing attention.
    expect(user).not.toContain('Checks needing attention');
  });

  it('selects the system prompt by language', () => {
    expect(buildCoachingPrompt(ctx(approvedGov), 'en').system).toContain(
      'Respond in English.',
    );
    expect(buildCoachingPrompt(ctx(approvedGov), 'fr').system).toContain(
      'Répondez en français.',
    );
  });
});
