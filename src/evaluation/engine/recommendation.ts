/**
 * Pre-trade recommendation (spec Section 5.3). Advisory only — it never blocks
 * the trade. Deterministic derivation from the two pre-trade scores:
 *
 *   proceed    : setupQuality >= 70 AND (planAdherence >= 80 OR no plan)
 *   reconsider : either score below 40 OR a major rule violation
 *   caution    : otherwise (the in-between band)
 *
 * `reconsider` takes precedence over `proceed` when both could apply, since the
 * spec lists the failing conditions as overriding (a major violation or a sub-40
 * score is disqualifying regardless of the other dimension).
 */

import { PlanAdherenceScore, Recommendation, SetupQualityScore } from './types';

export function deriveRecommendation(
  setupQuality: SetupQualityScore,
  planAdherence: PlanAdherenceScore | null,
): Recommendation {
  const setup = setupQuality.total;
  const adherence = planAdherence?.total ?? null;
  const majorViolation = planAdherence?.ruleBreaker ?? false;

  // reconsider: either score below 40, or any major rule violation.
  if (setup < 40 || (adherence !== null && adherence < 40) || majorViolation) {
    return 'reconsider';
  }

  // proceed: strong setup AND (strong adherence OR no plan to grade against).
  if (setup >= 70 && (adherence === null || adherence >= 80)) {
    return 'proceed';
  }

  // caution: the in-between band.
  return 'caution';
}
