import {
  directionToExecution,
  executionToDirection,
  toRiskCalculationView,
} from './risk.mapper';
import { RiskCalculation } from './engine';

describe('execution ↔ direction mapping', () => {
  it('maps buy → long and sell → short', () => {
    expect(executionToDirection('buy')).toBe('long');
    expect(executionToDirection('sell')).toBe('short');
  });

  it('maps long → buy and short → sell', () => {
    expect(directionToExecution('long')).toBe('buy');
    expect(directionToExecution('short')).toBe('sell');
  });

  it('round-trips both directions', () => {
    expect(directionToExecution(executionToDirection('buy'))).toBe('buy');
    expect(directionToExecution(executionToDirection('sell'))).toBe('sell');
  });

  it('treats any non-buy execution as short (defensive)', () => {
    expect(executionToDirection('SELL')).toBe('short');
    expect(executionToDirection('')).toBe('short');
  });
});

describe('toRiskCalculationView', () => {
  const calc: RiskCalculation = {
    pair: 'EURUSD',
    instrument: 'forex',
    direction: 'short',
    entryPrice: 1.1,
    stopPrice: 1.105,
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

  it('renders the calc in app vocabulary (symbol/execution/entry)', () => {
    const view = toRiskCalculationView(calc, 1.27);
    expect(view.symbol).toBe('EURUSD');
    expect(view.execution).toBe('sell'); // direction 'short' → 'sell'
    expect(view.entry).toBe(1.1);
    expect(view.lotSizeRounded).toBe(0.2);
    expect(view.exchangeRate).toBe(1.27);
    expect(view).not.toHaveProperty('direction');
    expect(view).not.toHaveProperty('pair');
  });
});
