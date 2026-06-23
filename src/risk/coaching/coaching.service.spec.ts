import { CoachingService } from './coaching.service';
import { CoachingContext, CoachingProvider } from './coaching.interface';
import { GovernanceResult } from '../engine';
import { RiskCalculationView } from '../risk.mapper';

const calculation = {
  symbol: 'EURUSD',
  execution: 'buy',
  instrument: 'forex',
  entry: 1.1,
  stopPrice: 1.095,
  targetPrice: null,
  exchangeRate: 1,
  stopDistancePips: 50,
  pipValue: 10,
  pipSize: 0.0001,
  maxCapitalExposure: 100,
  lotSize: 0.2,
  lotSizeRounded: 0.2,
  actualCapitalExposure: 100,
  capitalExposurePct: 1,
  rewardPips: null,
  rewardToRisk: null,
} as RiskCalculationView;

const governance: GovernanceResult = {
  overallStatus: 'approved',
  checks: [],
  blockedReason: null,
  aiCoaching: null,
};

const context: CoachingContext = {
  calculation,
  governance,
  accountCurrency: 'USD',
};

function make(generate: jest.Mock) {
  const provider: CoachingProvider = { name: 'test', generate };
  return new CoachingService(provider);
}

describe('CoachingService.generateCoaching', () => {
  it('returns the trimmed provider output', async () => {
    const service = make(jest.fn().mockResolvedValue('  Looks good.  '));
    expect(await service.generateCoaching(context, 'en')).toBe('Looks good.');
  });

  it('returns null for empty output', async () => {
    const service = make(jest.fn().mockResolvedValue('   '));
    expect(await service.generateCoaching(context, 'en')).toBeNull();
  });

  it('returns null (never throws) when the provider fails', async () => {
    const service = make(
      jest.fn().mockRejectedValue(new Error('all providers down')),
    );
    expect(await service.generateCoaching(context, 'en')).toBeNull();
  });
});
