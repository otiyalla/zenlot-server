import { deriveRecommendation } from './recommendation';
import { PlanAdherenceScore, SetupQualityScore } from './types';

function setup(total: number): SetupQualityScore {
  return {
    total,
    grade: 'C',
    breakdown: [],
    highProbability: total >= 70,
  };
}

function adherence(total: number, ruleBreaker = false): PlanAdherenceScore {
  return { total, grade: 'C', violations: [], ruleBreaker };
}

describe('deriveRecommendation', () => {
  describe('proceed', () => {
    it('setup >= 70 AND adherence >= 80', () => {
      expect(deriveRecommendation(setup(70), adherence(80))).toBe('proceed');
    });
    it('setup >= 70 AND no plan (adherence null)', () => {
      expect(deriveRecommendation(setup(90), null)).toBe('proceed');
    });
  });

  describe('reconsider — takes precedence', () => {
    it('setup below 40', () => {
      expect(deriveRecommendation(setup(39), adherence(100))).toBe(
        'reconsider',
      );
    });
    it('adherence below 40', () => {
      expect(deriveRecommendation(setup(100), adherence(39))).toBe(
        'reconsider',
      );
    });
    it('any major rule violation, even with high scores', () => {
      expect(deriveRecommendation(setup(100), adherence(85, true))).toBe(
        'reconsider',
      );
    });
  });

  describe('caution — the in-between band', () => {
    it('setup 40–69 with no disqualifier', () => {
      expect(deriveRecommendation(setup(69), adherence(100))).toBe('caution');
    });
    it('strong setup but adherence 40–79', () => {
      expect(deriveRecommendation(setup(90), adherence(79))).toBe('caution');
    });
    it('boundary: setup exactly 40 (not below 40) and adherence 40', () => {
      expect(deriveRecommendation(setup(40), adherence(40))).toBe('caution');
    });
  });
});
