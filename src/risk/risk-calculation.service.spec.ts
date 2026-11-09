import { BadRequestException } from '@nestjs/common';
import { RiskCalculationService } from './risk-calculation.service';
import { RiskProfileService } from './risk-profile.service';
import { PortfolioService } from './portfolio.service';
import { DrawdownService } from './drawdown.service';
import { RateResolverService } from './rate-resolver.service';
import { DrawdownState, PortfolioSnapshot } from './engine';

const CURRENCY = 'USD';

const profile = {
  userId: 'u1',
  maxRiskPerTradePct: 1,
  maxPortfolioExposurePct: 3,
  maxDailyDrawdownPct: 5,
  maxWeeklyDrawdownPct: 8,
  maxMonthlyDrawdownPct: 10,
  maxOpenTrades: 5,
  maxCorrelatedExposure: 6,
  accountBalance: 10000,
  accountCurrency: CURRENCY,
  lastBalanceSetAt: new Date(),
  lastBalanceSource: 'manual',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const emptyPortfolio: PortfolioSnapshot = {
  openTradeCount: 0,
  totalCapitalExposurePct: 0,
  totalCapitalExposure: 0,
  openTrades: [],
};

const neutralDrawdown: DrawdownState = {
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

function makeService(overrides?: {
  resolveExchangeRate?: jest.Mock;
  getProfile?: jest.Mock;
  getSnapshot?: jest.Mock;
  getState?: jest.Mock;
}) {
  const resolveExchangeRate =
    overrides?.resolveExchangeRate ?? jest.fn().mockResolvedValue(1);
  const getProfile =
    overrides?.getProfile ?? jest.fn().mockResolvedValue(profile);
  const getSnapshot =
    overrides?.getSnapshot ?? jest.fn().mockResolvedValue(emptyPortfolio);
  const getState =
    overrides?.getState ?? jest.fn().mockResolvedValue(neutralDrawdown);

  const service = new RiskCalculationService(
    { resolveExchangeRate } as unknown as RateResolverService,
    { getProfile } as unknown as RiskProfileService,
    { getSnapshot } as unknown as PortfolioService,
    { getState } as unknown as DrawdownService,
  );
  return { service, resolveExchangeRate, getProfile, getSnapshot, getState };
}

// 37-pip stop → floor-rounded lot 0.27 → ~0.999% exposure.
const subLimitTrade = {
  symbol: 'EURUSD',
  execution: 'buy' as const,
  entry: 1.1,
  stopPrice: 1.0963,
};

describe('RiskCalculationService.calculate', () => {
  it('sizes the trade and approves it (per-trade check is informational)', async () => {
    const { service, resolveExchangeRate } = makeService();
    const result = await service.calculate('u1', CURRENCY, subLimitTrade);

    expect(resolveExchangeRate).toHaveBeenCalledWith('EURUSD', 'USD');
    expect(result.calculation.symbol).toBe('EURUSD');
    expect(result.calculation.execution).toBe('buy');
    expect(result.calculation.exchangeRate).toBe(1);
    expect(result.calculation.lotSizeRounded).toBeCloseTo(0.27, 6);
    expect(result.governance.overallStatus).toBe('approved');
    const perTrade = result.governance.checks.find(
      (c) => c.rule === 'maxRiskPerTrade',
    );
    expect(perTrade?.informational).toBe(true);
    expect(result.governance.aiCoaching).toBeNull();
  });

  it('echoes a sell execution (mapped short→sell) in the view', async () => {
    const { service } = makeService();
    const result = await service.calculate('u1', CURRENCY, {
      symbol: 'EURUSD',
      execution: 'sell',
      entry: 1.1,
      stopPrice: 1.1037,
    });
    expect(result.calculation.execution).toBe('sell');
  });

  it('applies the resolved cross rate to pip value', async () => {
    const resolveExchangeRate = jest.fn().mockResolvedValue(1.27);
    const { service } = makeService({ resolveExchangeRate });
    const result = await service.calculate('u1', CURRENCY, {
      symbol: 'EURGBP',
      execution: 'buy',
      entry: 0.86,
      stopPrice: 0.8563,
    });
    // pipValue = 0.0001 × 100000 × 1.27 = 12.7
    expect(result.calculation.pipValue).toBeCloseTo(12.7, 6);
  });

  it('rejects when no account balance is set', async () => {
    const getProfile = jest
      .fn()
      .mockResolvedValue({ ...profile, accountBalance: 0 });
    const { service } = makeService({ getProfile });
    await expect(
      service.calculate('u1', CURRENCY, subLimitTrade),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps invalid trade geometry to a 400', async () => {
    const { service } = makeService();
    await expect(
      service.calculate('u1', CURRENCY, {
        symbol: 'EURUSD',
        execution: 'buy',
        entry: 1.1,
        stopPrice: 1.1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps directionally invalid geometry to a 400', async () => {
    const { service } = makeService();
    await expect(
      service.calculate('u1', CURRENCY, {
        symbol: 'EURUSD',
        execution: 'buy',
        entry: 1.1,
        stopPrice: 1.095,
        targetPrice: 1.09,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks when projected portfolio exposure exceeds the limit', async () => {
    const getSnapshot = jest.fn().mockResolvedValue({
      openTradeCount: 1,
      totalCapitalExposurePct: 2.5,
      totalCapitalExposure: 250,
      openTrades: [
        { tradeId: 'x', pair: 'AUDUSD', direction: 'long', exposurePct: 2.5 },
      ],
    });
    const { service } = makeService({ getSnapshot });
    const result = await service.calculate('u1', CURRENCY, subLimitTrade);
    expect(result.governance.overallStatus).toBe('blocked');
    expect(result.governance.blockedReason).toBe(
      'Total portfolio exposure after this trade',
    );
  });

  it('blocks new trades when the daily circuit breaker is breached', async () => {
    const getState = jest.fn().mockResolvedValue({
      ...neutralDrawdown,
      drawdownPct: { ...neutralDrawdown.drawdownPct, daily: 2 },
      circuitBreakers: {
        ...neutralDrawdown.circuitBreakers,
        dailyBreached: true,
      },
    });
    const { service } = makeService({ getState });
    const result = await service.calculate('u1', CURRENCY, subLimitTrade);
    expect(result.governance.overallStatus).toBe('blocked');
  });

  it('localizes the governance result to the user language', async () => {
    const getSnapshot = jest.fn().mockResolvedValue({
      openTradeCount: 1,
      totalCapitalExposurePct: 2.5,
      totalCapitalExposure: 250,
      openTrades: [
        { tradeId: 'x', pair: 'AUDUSD', direction: 'long', exposurePct: 2.5 },
      ],
    });
    const { service } = makeService({ getSnapshot });
    const result = await service.calculate('u1', CURRENCY, subLimitTrade, 'fr');
    expect(result.governance.blockedReason).toBe(
      'Exposition totale du portefeuille après ce trade',
    );
  });
});

describe('RiskCalculationService.calculateActiveTrade', () => {
  it.each([
    ['buy', 1.105],
    ['buy', 1.1],
    ['sell', 1.095],
    ['sell', 1.1],
  ] as const)(
    'allows an active %s stop at %s and reports zero remaining exposure',
    async (execution, stopPrice) => {
      const { service, getSnapshot, getState } = makeService();
      const result = await service.calculateActiveTrade('u1', CURRENCY, {
        symbol: 'EURUSD',
        execution,
        entry: 1.1,
        stopPrice,
        targetPrice: execution === 'buy' ? 1.12 : 1.08,
        lot: 0.2,
      });

      expect(result.actualCapitalExposure).toBe(0);
      expect(result.capitalExposurePct).toBe(0);
      expect(result.rewardPips).toBeCloseTo(200, 6);
      expect(result.rewardToRisk).toBeNull();
      expect(getSnapshot).not.toHaveBeenCalled();
      expect(getState).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['buy', 1.09],
    ['buy', 1.102],
    ['sell', 1.11],
    ['sell', 1.098],
  ] as const)(
    'rejects an active %s target with invalid entry/stop ordering',
    async (execution, targetPrice) => {
      const { service } = makeService();
      await expect(
        service.calculateActiveTrade('u1', CURRENCY, {
          symbol: 'EURUSD',
          execution,
          entry: 1.1,
          stopPrice: execution === 'buy' ? 1.105 : 1.095,
          targetPrice,
          lot: 0.2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

describe('RiskCalculationService.validateActiveTradeGeometry', () => {
  it('validates active geometry without loading profile or market data', () => {
    const { service, getProfile, resolveExchangeRate } = makeService();

    expect(() =>
      service.validateActiveTradeGeometry({
        symbol: 'EURUSD',
        execution: 'buy',
        entry: 1.1,
        stopPrice: 1.105,
        targetPrice: 1.102,
        lot: 0.2,
      }),
    ).toThrow(BadRequestException);
    expect(getProfile).not.toHaveBeenCalled();
    expect(resolveExchangeRate).not.toHaveBeenCalled();
  });
});
