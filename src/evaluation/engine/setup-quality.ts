/**
 * Setup Quality Score (spec Section 5.1). Deterministic weighted sum of the
 * four-factor confluence framework plus entry-trigger quality, from the trader's
 * self-reported checklist. No AI, no I/O.
 *
 * Weights (total 100): Momentum 30, Pattern 25, Price Zone 25, Time 10,
 * Entry Trigger 10. Momentum is the most decisive filter, time the softest.
 */

import {
  Confidence,
  EntryTriggerType,
  Grade,
  PreTradeChecklist,
  SetupDimension,
  SetupQualityScore,
} from './types';

const PATTERN_POINTS: Record<Confidence, number> = {
  high: 25,
  medium: 15,
  low: 8,
};

const TRIGGER_POINTS: Record<EntryTriggerType, number> = {
  trailing_1BH: 10,
  trailing_1BL: 10,
  swing_entry: 6,
  limit: 4,
  market: 0,
  other: 0,
};

export function scoreSetupQuality(
  checklist: PreTradeChecklist,
): SetupQualityScore {
  let score = 0;
  const breakdown: SetupDimension[] = [];

  // Factor 1 — Momentum (30 points)
  // Full: higher TF clear + lower TF reversal confirmed. Partial: higher TF
  // clear but reversal uncertain. Zero: higher TF unclear.
  const momentumPoints =
    checklist.momentum.higherTfDirection !== 'unclear'
      ? checklist.momentum.lowerTfReversal
        ? 30
        : 15
      : 0;
  score += momentumPoints;
  breakdown.push({ factor: 'momentum', points: momentumPoints, max: 30 });

  // Factor 2 — Pattern (25 points): high 25 / medium 15 / low 8 / none 0.
  const patternPoints = checklist.pattern.identified
    ? PATTERN_POINTS[checklist.pattern.confidence]
    : 0;
  score += patternPoints;
  breakdown.push({ factor: 'pattern', points: patternPoints, max: 25 });

  // Factor 3 — Price Zone (25 points): confluence 25 / at-level 15 / none 0.
  const pricePoints = checklist.priceZone.atSignificantLevel
    ? checklist.priceZone.confluence
      ? 25
      : 15
    : 0;
  score += pricePoints;
  breakdown.push({ factor: 'priceZone', points: pricePoints, max: 25 });

  // Factor 4 — Time (10 points, soft).
  const timePoints = checklist.timeConfluence.inTimeZone ? 10 : 0;
  score += timePoints;
  breakdown.push({ factor: 'timeConfluence', points: timePoints, max: 10 });

  // Entry trigger quality (10 points).
  const triggerPoints = TRIGGER_POINTS[checklist.entryTrigger.type] ?? 0;
  score += triggerPoints;
  breakdown.push({ factor: 'entryTrigger', points: triggerPoints, max: 10 });

  return {
    total: score, // 0–100
    grade: scoreToGrade(score),
    breakdown,
    highProbability: score >= 70, // all four factors substantially aligned
  };
}

/** Grade cutoffs (spec Section 5.1): A≥85, B≥70, C≥55, D≥40, else F. */
export function scoreToGrade(score: number): Grade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}
