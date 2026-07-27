/**
 * Deterministic calculation engine (spec Section 13). Pure functions — no DB,
 * no API calls, no side effects. Every number a trader acts on originates here.
 *
 * Multi-instrument money model (generalises the spec's forex pip math):
 *
 *   valuePerLot           = contractSize × exchangeRate    (exchangeRate = quote→account)
 *   priceDistance         = |entry − stop|
 *   maxCapitalExposure    = balance × maxRiskPct / 100
 *   lotSize               = maxCapitalExposure / (priceDistance × valuePerLot)
 *   actualCapitalExposure = lotSizeRounded × priceDistance × valuePerLot
 *
 * For forex this equals the spec exactly: with contractSize 100 000, valuePerLot
 * is the standard-lot pip value across all three pip-value cases (the caller
 * supplies the correct quote→account exchangeRate).
 */

import {
  getContractSize,
  getInstrumentType,
  getLotStep,
  getPipSize,
  getValuePerLot,
} from './instruments';
import { Direction, RiskCalculation } from './types';

/** Thrown when trade geometry or account inputs make sizing impossible. */
export class RiskCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RiskCalculationError';
  }
}

/** Floor `value` down to the nearest multiple of `step` (never rounds up). */
export function floorToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const inv = Math.round(1 / step);
  // Small epsilon absorbs binary float error (e.g. 0.07/0.01 = 6.9999999).
  return Math.floor(value * inv + 1e-9) / inv;
}

export interface PositionSizeInput {
  accountBalance: number;
  maxRiskPct: number;
  entryPrice: number;
  stopPrice: number;
  pipSize: number;
  /** Units per standard lot for the instrument. */
  contractSize: number;
  /** Quote-currency → account-currency rate (1.0 if quote === account). */
  exchangeRate: number;
  /** Lot rounding step. Defaults to 0.01 (micro-lot). */
  lotStep?: number;
}

export interface PositionSizeResult {
  stopDistancePips: number;
  pipValue: number;
  maxCapitalExposure: number;
  lotSize: number;
  lotSizeRounded: number;
  actualCapitalExposure: number;
  capitalExposurePct: number;
}

/**
 * Computes position size and capital exposure. Throws RiskCalculationError on
 * non-positive balance/risk, identical entry & stop, or non-positive
 * value-per-lot — logging a trade on bad inputs would persist a wrong exposure.
 */
export function calculatePositionSize(
  input: PositionSizeInput,
): PositionSizeResult {
  const {
    accountBalance,
    maxRiskPct,
    entryPrice,
    stopPrice,
    pipSize,
    contractSize,
    exchangeRate,
    lotStep = 0.01,
  } = input;

  if (accountBalance <= 0)
    throw new RiskCalculationError('accountBalance must be positive');
  if (maxRiskPct <= 0)
    throw new RiskCalculationError('maxRiskPct must be positive');
  if (entryPrice <= 0)
    throw new RiskCalculationError('entryPrice must be positive');
  if (pipSize <= 0) throw new RiskCalculationError('pipSize must be positive');

  const priceDistance = Math.abs(entryPrice - stopPrice);
  if (priceDistance <= 0) {
    throw new RiskCalculationError('entryPrice and stopPrice must differ');
  }

  const valuePerLot = contractSize * exchangeRate;
  if (valuePerLot <= 0) {
    throw new RiskCalculationError(
      'contractSize × exchangeRate must be positive',
    );
  }

  const maxCapitalExposure = accountBalance * (maxRiskPct / 100);
  const stopDistancePips = priceDistance / pipSize;
  const pipValue = pipSize * valuePerLot;

  const lotSize = maxCapitalExposure / (priceDistance * valuePerLot);
  // Round DOWN — never round up, never exceed the configured risk.
  const lotSizeRounded = floorToStep(lotSize, lotStep);
  const actualCapitalExposure = lotSizeRounded * priceDistance * valuePerLot;
  const capitalExposurePct = (actualCapitalExposure / accountBalance) * 100;

  return {
    stopDistancePips,
    pipValue,
    maxCapitalExposure,
    lotSize,
    lotSizeRounded,
    actualCapitalExposure,
    capitalExposurePct,
  };
}

/** Reward distance and reward-to-risk ratio (spec Section 13.4). */
export function calculateRewardToRisk(
  entryPrice: number,
  stopPrice: number,
  targetPrice: number,
  pipSize: number,
): { rewardPips: number; rewardToRisk: number } {
  if (pipSize <= 0) throw new RiskCalculationError('pipSize must be positive');
  const stopDistancePips = Math.abs(entryPrice - stopPrice) / pipSize;
  if (stopDistancePips <= 0) {
    throw new RiskCalculationError('entryPrice and stopPrice must differ');
  }
  const rewardPips = Math.abs(targetPrice - entryPrice) / pipSize;
  return { rewardPips, rewardToRisk: rewardPips / stopDistancePips };
}

/**
 * R-multiple on close (spec Section 13.4). +1.0 = closed at 1R profit,
 * −1.0 = stopped out at full loss, +2.5 = 2.5R winner.
 */
export function calculateRMultiple(
  entryPrice: number,
  exitPrice: number,
  stopPrice: number,
  direction: Direction,
): number {
  const risk = Math.abs(entryPrice - stopPrice);
  if (risk <= 0)
    throw new RiskCalculationError('entryPrice and stopPrice must differ');
  const move =
    direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return move / risk;
}

export interface PnLInput {
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  lotSize: number;
  direction: Direction;
  /** Quote→account rate at close (use the close-time rate for accurate PnL). */
  exchangeRate: number;
}

/**
 * Realized PnL in the account currency. Positive for a winning move, negative
 * for a loss. Uses the same value-per-lot model as sizing.
 */
export function calculatePnL(input: PnLInput): number {
  const { symbol, entryPrice, exitPrice, lotSize, direction, exchangeRate } =
    input;
  const move =
    direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return move * lotSize * getContractSize(symbol) * exchangeRate;
}

/** Drawdown percentages, floored at 0 (spec Section 13.5). */
export function calculateDrawdown(
  currentBalance: number,
  dailyOpenBalance: number,
  weeklyOpenBalance: number,
  monthlyOpenBalance: number,
  peakBalance: number,
): { daily: number; weekly: number; monthly: number; allTime: number } {
  const pct = (open: number): number =>
    open > 0 ? Math.max(0, ((open - currentBalance) / open) * 100) : 0;
  return {
    daily: pct(dailyOpenBalance),
    weekly: pct(weeklyOpenBalance),
    monthly: pct(monthlyOpenBalance),
    allTime: pct(peakBalance),
  };
}

export interface RiskCalculationInput {
  pair: string;
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number | null;
  accountBalance: number;
  maxRiskPct: number;
  /** Quote-currency → account-currency rate (1.0 if quote === account). */
  exchangeRate: number;
  /**
   * Optional user-chosen lot. When provided (> 0) it overrides the engine's
   * computed size: `lotSizeRounded` and capital exposure are derived from this
   * value instead, while `lotSize` still reports the engine's recommendation.
   * Floored to the instrument lot step.
   */
  lot?: number | null;
}

/**
 * Validates directional trade geometry at the engine boundary.  The lower-level
 * sizing helpers intentionally remain direction-agnostic for backwards
 * compatibility; composed risk calculations must enforce that stops protect
 * in the adverse direction and targets lie in the profitable direction.
 */
function validateTradeGeometry(input: RiskCalculationInput): void {
  const { direction, entryPrice, stopPrice, targetPrice } = input;

  if (targetPrice !== undefined && targetPrice !== null && targetPrice <= 0) {
    throw new RiskCalculationError(
      'targetPrice must be positive when provided',
    );
  }

  if (direction === 'long') {
    if (stopPrice >= entryPrice) {
      throw new RiskCalculationError(
        'For long trades, stopPrice must be strictly below entryPrice',
      );
    }
    if (
      targetPrice !== undefined &&
      targetPrice !== null &&
      targetPrice <= entryPrice
    ) {
      throw new RiskCalculationError(
        'For long trades, targetPrice must be strictly above entryPrice',
      );
    }
    return;
  }

  if (stopPrice <= entryPrice) {
    throw new RiskCalculationError(
      'For short trades, stopPrice must be strictly above entryPrice',
    );
  }
  if (
    targetPrice !== undefined &&
    targetPrice !== null &&
    targetPrice >= entryPrice
  ) {
    throw new RiskCalculationError(
      'For short trades, targetPrice must be strictly below entryPrice',
    );
  }
}

/**
 * Convenience composer: resolves instrument metadata, sizes the position, and
 * attaches reward fields when a target is supplied. Pure — the caller is
 * responsible for fetching the live exchange rate and passing it in.
 *
 * Spec principle is "position size is the output" — so the engine always returns
 * a recommended size (`lotSize`). The optional `lot` override lets the trader
 * size manually (the app permits this), in which case exposure reflects what
 * they will actually trade.
 */
export function computeRiskCalculation(
  input: RiskCalculationInput,
): RiskCalculation {
  const {
    pair,
    direction,
    entryPrice,
    stopPrice,
    targetPrice,
    accountBalance,
    maxRiskPct,
    exchangeRate,
    lot,
  } = input;

  validateTradeGeometry(input);

  const instrument = getInstrumentType(pair);
  const pipSize = getPipSize(pair);
  const contractSize = getContractSize(pair);
  const lotStep = getLotStep(pair);

  const sizing = calculatePositionSize({
    accountBalance,
    maxRiskPct,
    entryPrice,
    stopPrice,
    pipSize,
    contractSize,
    exchangeRate,
    lotStep,
  });

  // Honour a user-chosen lot: derive exposure from it, but keep the engine's
  // recommendation in `lotSize`.
  let lotSizeRounded = sizing.lotSizeRounded;
  let actualCapitalExposure = sizing.actualCapitalExposure;
  let capitalExposurePct = sizing.capitalExposurePct;
  if (lot !== undefined && lot !== null && lot > 0) {
    const priceDistance = Math.abs(entryPrice - stopPrice);
    const valuePerLot = contractSize * exchangeRate;
    lotSizeRounded = floorToStep(lot, lotStep);
    actualCapitalExposure = lotSizeRounded * priceDistance * valuePerLot;
    capitalExposurePct = (actualCapitalExposure / accountBalance) * 100;
  }

  let rewardPips: number | null = null;
  let rewardToRisk: number | null = null;
  if (targetPrice !== undefined && targetPrice !== null) {
    const reward = calculateRewardToRisk(
      entryPrice,
      stopPrice,
      targetPrice,
      pipSize,
    );
    rewardPips = reward.rewardPips;
    rewardToRisk = reward.rewardToRisk;
  }

  return {
    pair,
    instrument,
    direction,
    entryPrice,
    stopPrice,
    targetPrice: targetPrice ?? null,
    pipSize,
    stopDistancePips: sizing.stopDistancePips,
    pipValue: sizing.pipValue,
    maxCapitalExposure: sizing.maxCapitalExposure,
    lotSize: sizing.lotSize,
    lotSizeRounded,
    actualCapitalExposure,
    capitalExposurePct,
    rewardPips,
    rewardToRisk,
  };
}

export { getValuePerLot };
