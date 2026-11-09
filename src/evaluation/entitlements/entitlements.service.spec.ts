import { EntitlementsService, EvaluationFeature } from './entitlements.service';

describe('EntitlementsService (Phase 2 — ungated seam)', () => {
  const service = new EntitlementsService();
  const user = { id: 'user-1' };

  it('grants access to every evaluation feature (ungated for Phase 2)', () => {
    for (const feature of Object.values(EvaluationFeature)) {
      expect(service.canAccess(feature, user)).toBe(true);
    }
  });

  it('exposes the Pro-only features named in spec Section 12', () => {
    expect(EvaluationFeature.PlanAdherenceScore).toBeDefined();
    expect(EvaluationFeature.ExecutionGrade).toBeDefined();
    expect(EvaluationFeature.ProcessVsOutcomeVerdict).toBeDefined();
    expect(EvaluationFeature.LuckyFlag).toBeDefined();
    expect(EvaluationFeature.AiCoachingPerTrade).toBeDefined();
    expect(EvaluationFeature.BehavioralReport).toBeDefined();
    expect(EvaluationFeature.BehavioralPatternHistory).toBeDefined();
    expect(EvaluationFeature.TradingPlanVersioning).toBeDefined();
  });
});
