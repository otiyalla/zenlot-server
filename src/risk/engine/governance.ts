/**
 * Pre-trade governance engine (spec Section 14). Deterministic — no AI.
 * Returns synchronously; `aiCoaching` is always null here and populated later
 * by the async coaching layer.
 *
 * Thresholds: a check is `blocked` at/above the limit, `warning` at/above 80%
 * of the limit, otherwise `approved`. Circuit breakers additionally block once
 * the period has been breached, regardless of the current value.
 *
 * The per-trade capital-exposure check is INFORMATIONAL: the sizer targets the
 * per-trade cap, so this check would otherwise always warn/block on a correctly
 * sized trade. It is surfaced to the trader but excluded from the overall verdict.
 *
 * User-facing `message` text is localized via `language`; the `rule` id stays
 * stable/English for logic and audit.
 */

import { getCorrelatedPairs } from './correlations';
import { governanceMessage, Language } from './i18n';
import {
  GovernanceCheck,
  GovernanceResult,
  GovernanceStatus,
  PortfolioSnapshot,
  RiskCalculation,
  RiskProfile,
  DrawdownState,
} from './types';

const WARNING_RATIO = 0.8;
const MIN_REWARD_TO_RISK = 2.0;

export function checkRule(
  rule: string,
  actual: number,
  limit: number,
  message: string,
): GovernanceCheck {
  let status: GovernanceStatus = 'approved';
  if (actual >= limit) status = 'blocked';
  else if (actual >= limit * WARNING_RATIO) status = 'warning';
  return { rule, status, actual, limit, message };
}

export function checkCircuitBreaker(
  rule: string,
  actual: number,
  limit: number,
  alreadyBreached: boolean,
  message: string,
): GovernanceCheck {
  let status: GovernanceStatus = 'approved';
  if (actual >= limit || alreadyBreached) status = 'blocked';
  else if (actual >= limit * WARNING_RATIO) status = 'warning';
  return { rule, status, actual, limit, message };
}

/** The overall verdict ignores informational checks (they never gate a trade). */
export function deriveOverallStatus(
  checks: GovernanceCheck[],
): GovernanceStatus {
  const gating = checks.filter((c) => !c.informational);
  if (gating.some((c) => c.status === 'blocked')) return 'blocked';
  if (gating.some((c) => c.status === 'warning')) return 'warning';
  return 'approved';
}

/**
 * Combined exposure across open trades correlated with this one in the SAME
 * direction, plus the new trade (spec Section 11.3).
 */
export function checkCorrelatedExposure(
  calc: RiskCalculation,
  portfolio: PortfolioSnapshot,
  profile: RiskProfile,
  language: Language = 'en',
): GovernanceCheck {
  const correlatedPairs = getCorrelatedPairs(calc.pair);
  const existing = portfolio.openTrades
    .filter(
      (t) =>
        correlatedPairs.includes(t.pair.toUpperCase()) &&
        t.direction === calc.direction,
    )
    .reduce((sum, t) => sum + t.exposurePct, 0);
  const projected = existing + calc.capitalExposurePct;
  return checkRule(
    'maxCorrelatedExposure',
    projected,
    profile.maxCorrelatedExposure,
    governanceMessage('maxCorrelatedExposure', language),
  );
}

/**
 * Runs every governance check and derives the overall verdict. The trade may be
 * logged unless `overallStatus === 'blocked'`.
 */
export function evaluateGovernance(
  calc: RiskCalculation,
  portfolio: PortfolioSnapshot,
  drawdown: DrawdownState,
  profile: RiskProfile,
  language: Language = 'en',
): GovernanceResult {
  const checks: GovernanceCheck[] = [];

  // 1: per-trade capital exposure — INFORMATIONAL (never gates; see file header)
  checks.push({
    ...checkRule(
      'maxRiskPerTrade',
      calc.capitalExposurePct,
      profile.maxRiskPerTradePct,
      governanceMessage('maxRiskPerTrade', language),
    ),
    informational: true,
  });

  // 2: projected portfolio exposure after adding this trade
  checks.push(
    checkRule(
      'maxPortfolioExposure',
      portfolio.totalCapitalExposurePct + calc.capitalExposurePct,
      profile.maxPortfolioExposurePct,
      governanceMessage('maxPortfolioExposure', language),
    ),
  );

  // 3: open trade count
  checks.push(
    checkRule(
      'maxOpenTrades',
      portfolio.openTradeCount,
      profile.maxOpenTrades,
      governanceMessage('maxOpenTrades', language),
    ),
  );

  // 4: daily drawdown circuit breaker
  checks.push(
    checkCircuitBreaker(
      'dailyDrawdown',
      drawdown.drawdownPct.daily,
      profile.maxDailyDrawdownPct,
      drawdown.circuitBreakers.dailyBreached,
      governanceMessage('dailyDrawdown', language),
    ),
  );

  // 5: monthly drawdown circuit breaker
  checks.push(
    checkCircuitBreaker(
      'monthlyDrawdown',
      drawdown.drawdownPct.monthly,
      profile.maxMonthlyDrawdownPct,
      drawdown.circuitBreakers.monthlyBreached,
      governanceMessage('monthlyDrawdown', language),
    ),
  );

  // 6: correlated-pair exposure
  checks.push(checkCorrelatedExposure(calc, portfolio, profile, language));

  // 7: reward-to-risk minimum — warn below 2:1, never block
  if (calc.rewardToRisk !== null) {
    checks.push({
      rule: 'minRewardToRisk',
      status: calc.rewardToRisk < MIN_REWARD_TO_RISK ? 'warning' : 'approved',
      actual: calc.rewardToRisk,
      limit: MIN_REWARD_TO_RISK,
      message: governanceMessage('minRewardToRisk', language),
    });
  }

  const overallStatus = deriveOverallStatus(checks);
  const blockedCheck = checks.find(
    (c) => !c.informational && c.status === 'blocked',
  );

  return {
    overallStatus,
    checks,
    blockedReason: blockedCheck?.message ?? null,
    aiCoaching: null,
  };
}
