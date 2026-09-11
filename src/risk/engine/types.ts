/**
 * Phase 1 Risk Engine — shared types.
 *
 * The engine speaks the spec's vocabulary: `direction: 'long' | 'short'` and
 * `pair`. The rest of the app uses `execution: 'buy' | 'sell'` and `symbol`
 * (long ≡ buy, short ≡ sell); mapping happens at the service boundary, never here.
 *
 * Every value in a RiskCalculation / GovernanceResult is produced by these pure
 * functions — no AI, no I/O. (Spec Section 2, Rule 1.)
 */

export type Direction = 'long' | 'short';

export type GovernanceStatus = 'approved' | 'warning' | 'blocked';

/** User-configurable governance rules (stored per user). */
export interface RiskProfile {
  maxRiskPerTradePct: number;
  maxPortfolioExposurePct: number;
  maxDailyDrawdownPct: number;
  maxWeeklyDrawdownPct: number;
  maxMonthlyDrawdownPct: number;
  maxOpenTrades: number;
  maxCorrelatedExposure: number;
  accountBalance: number;
  accountCurrency: string;
}

/** What the trader enters for a setup. */
export interface TradeSetupInput {
  pair: string;
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number | null;
  accountCurrency: string;
}

/** Pure output of the calculation engine — all numbers computed in TypeScript. */
export interface RiskCalculation {
  pair: string;
  instrument: string;
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;

  // Core pip math
  stopDistancePips: number;
  pipValue: number; // value of 1 pip per standard lot, in account currency
  pipSize: number;

  // Position sizing
  maxCapitalExposure: number;
  lotSize: number; // raw, before rounding
  recommendedLotSizeRounded: number; // engine's own rounded recommendation — never overridden by user lot
  lotSizeRounded: number; // rounded DOWN to the instrument lot step; equals recommendedLotSizeRounded unless the user supplied a manual lot
  actualCapitalExposure: number;
  capitalExposurePct: number;

  // Reward (null when no target supplied)
  rewardPips: number | null;
  rewardToRisk: number | null;
}

/** One open position's contribution to portfolio exposure. */
export interface OpenTradeExposure {
  tradeId: string;
  pair: string;
  direction: Direction;
  exposurePct: number;
}

/** Aggregate exposure across all open trades. */
export interface PortfolioSnapshot {
  openTradeCount: number;
  totalCapitalExposurePct: number;
  totalCapitalExposure: number;
  openTrades: OpenTradeExposure[];
}

export interface DrawdownPct {
  daily: number;
  weekly: number;
  monthly: number;
  allTime: number;
}

export interface DrawdownState {
  accountBalance: number;
  peakBalance: number;
  dailyOpenBalance: number;
  weeklyOpenBalance: number;
  monthlyOpenBalance: number;
  drawdownPct: DrawdownPct;
  circuitBreakers: {
    dailyBreached: boolean;
    weeklyBreached: boolean;
    monthlyBreached: boolean;
  };
}

export interface GovernanceCheck {
  rule: string;
  status: GovernanceStatus;
  actual: number;
  limit: number;
  message: string;
  /**
   * Informational checks are surfaced to the trader but never gate the trade —
   * they are excluded from the overall verdict. The per-trade capital-exposure
   * check is informational: the sizer targets the per-trade cap, so this check
   * would otherwise always warn/block on a correctly-sized trade.
   */
  informational?: boolean;
}

export interface GovernanceResult {
  overallStatus: GovernanceStatus;
  checks: GovernanceCheck[];
  blockedReason: string | null;
  aiCoaching: string | null; // populated asynchronously (Section 15) — never by the engine
}
