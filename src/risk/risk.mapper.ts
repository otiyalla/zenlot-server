/**
 * Boundary mappers between the app's vocabulary (`execution: 'buy' | 'sell'`,
 * `symbol`) and the risk engine's vocabulary (`direction: 'long' | 'short'`,
 * `pair`).
 *
 * The engine is intentionally pure and only knows long/short. ALL buy↔long /
 * sell↔short translation happens here, at the service boundary — never inside
 * the engine. Mapping: buy ≡ long, sell ≡ short.
 */
import { Direction, RiskCalculation } from './engine';

export type Execution = 'buy' | 'sell';

export function executionToDirection(execution: string): Direction {
  return execution === 'buy' ? 'long' : 'short';
}

export function directionToExecution(direction: Direction): Execution {
  return direction === 'long' ? 'buy' : 'sell';
}

/**
 * Client-facing view of a RiskCalculation in app vocabulary: `symbol` instead of
 * `pair`, `execution` instead of `direction`, `entry` instead of `entryPrice`.
 */
export interface RiskCalculationView {
  symbol: string;
  execution: Execution;
  instrument: string;
  entry: number;
  stopPrice: number;
  targetPrice: number | null;
  /** Quote→account rate used for sizing (1.0 when quote === account). */
  exchangeRate: number;
  stopDistancePips: number;
  pipValue: number;
  pipSize: number;
  maxCapitalExposure: number;
  lotSize: number;
  lotSizeRounded: number;
  actualCapitalExposure: number;
  capitalExposurePct: number;
  rewardPips: number | null;
  rewardToRisk: number | null;
}

export function toRiskCalculationView(
  calc: RiskCalculation,
  exchangeRate: number,
): RiskCalculationView {
  return {
    symbol: calc.pair,
    execution: directionToExecution(calc.direction),
    instrument: calc.instrument,
    entry: calc.entryPrice,
    stopPrice: calc.stopPrice,
    targetPrice: calc.targetPrice,
    exchangeRate,
    stopDistancePips: calc.stopDistancePips,
    pipValue: calc.pipValue,
    pipSize: calc.pipSize,
    maxCapitalExposure: calc.maxCapitalExposure,
    lotSize: calc.lotSize,
    lotSizeRounded: calc.lotSizeRounded,
    actualCapitalExposure: calc.actualCapitalExposure,
    capitalExposurePct: calc.capitalExposurePct,
    rewardPips: calc.rewardPips,
    rewardToRisk: calc.rewardToRisk,
  };
}
