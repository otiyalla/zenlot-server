/**
 * Plan Adherence Score (spec Section 5.2). Grades how well the declared setup
 * matches the trader's TradingPlan. Returns null if no plan exists (the UI then
 * prompts the trader to define one). Deterministic — no AI.
 *
 * Each required condition contributes weighted points; the raw points are
 * normalized to 0–100 against the max possible for the active rules. A `major`
 * violation makes the trade a ruleBreaker. Violation messages are localized via
 * the engine i18n module; the `rule` keys stay stable/English.
 */

import { Language, resolveLanguage } from '../../risk/engine/i18n';
import { stopPlacementViolationMessage, violationMessage } from './i18n';
import { scoreToGrade } from './setup-quality';
import {
  PlanAdherenceScore,
  PlanViolation,
  PreTradeChecklist,
  TradingPlan,
} from './types';

export function scorePlanAdherence(
  checklist: PreTradeChecklist,
  plan: TradingPlan | null,
  language: string | Language = 'en',
): PlanAdherenceScore | null {
  if (!plan) return null;

  const lang = resolveLanguage(language);
  let points = 0;
  let maxPoints = 0;
  const violations: PlanViolation[] = [];

  // Momentum alignment — 20 points, major.
  if (plan.entryConditions.requiresMomentumAlignment) {
    maxPoints += 20;
    if (
      checklist.momentum.higherTfDirection !== 'unclear' &&
      checklist.momentum.lowerTfReversal
    ) {
      points += 20;
    } else {
      violations.push({
        rule: 'momentumAlignment',
        severity: 'major',
        message: violationMessage('momentumAlignment', lang),
      });
    }
  }

  // Pattern required — 20 points, major.
  if (plan.entryConditions.requiresPattern) {
    maxPoints += 20;
    if (checklist.pattern.identified) {
      points += 20;
    } else {
      violations.push({
        rule: 'patternRequired',
        severity: 'major',
        message: violationMessage('patternRequired', lang),
      });
    }
  }

  // Price zone required — 20 points, major.
  if (plan.entryConditions.requiresPriceZone) {
    maxPoints += 20;
    if (checklist.priceZone.atSignificantLevel) {
      points += 20;
    } else {
      violations.push({
        rule: 'priceZoneRequired',
        severity: 'major',
        message: violationMessage('priceZoneRequired', lang),
      });
    }
  }

  // Time confluence required — 15 points, minor.
  if (plan.entryConditions.requiresTimeConfluence) {
    maxPoints += 15;
    if (checklist.timeConfluence.inTimeZone) {
      points += 15;
    } else {
      violations.push({
        rule: 'timeConfluenceRequired',
        severity: 'minor',
        message: violationMessage('timeConfluenceRequired', lang),
      });
    }
  }

  // Stop placement adherence — 25 points, major (always checked).
  maxPoints += 25;
  if (
    checklist.stopPlacement.logic === plan.stopRules.placement ||
    plan.stopRules.placement === 'custom'
  ) {
    points += 25;
  } else {
    violations.push({
      rule: 'stopPlacement',
      severity: 'major',
      message: stopPlacementViolationMessage(
        plan.stopRules.placement,
        checklist.stopPlacement.logic,
        lang,
      ),
    });
  }

  // Normalize to 0–100. No active rules → fully adherent (100).
  const total = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 100;

  return {
    total,
    grade: scoreToGrade(total),
    violations,
    ruleBreaker: violations.some((v) => v.severity === 'major'),
  };
}
