import { scorePlanAdherence } from './plan-adherence';
import { makeChecklist, makePlan } from './test-fixtures';

describe('scorePlanAdherence', () => {
  it('returns null when no plan exists', () => {
    expect(scorePlanAdherence(makeChecklist(), null)).toBeNull();
  });

  it('full 100 / grade A / no violations when checklist matches every rule', () => {
    const result = scorePlanAdherence(makeChecklist(), makePlan());
    expect(result).not.toBeNull();
    expect(result!.total).toBe(100);
    expect(result!.grade).toBe('A');
    expect(result!.violations).toHaveLength(0);
    expect(result!.ruleBreaker).toBe(false);
  });

  describe('individual violations', () => {
    it('momentumAlignment (major) when unclear/no reversal', () => {
      const r = scorePlanAdherence(
        makeChecklist({
          momentum: { higherTfDirection: 'unclear', lowerTfReversal: false },
        }),
        makePlan(),
      )!;
      const v = r.violations.find((x) => x.rule === 'momentumAlignment');
      expect(v?.severity).toBe('major');
      expect(r.ruleBreaker).toBe(true);
      // 80 of 100 points (lost 20 of 100 max).
      expect(r.total).toBe(80);
    });

    it('patternRequired (major) when no pattern', () => {
      const r = scorePlanAdherence(
        makeChecklist({ pattern: { identified: false } }),
        makePlan(),
      )!;
      expect(
        r.violations.find((x) => x.rule === 'patternRequired')?.severity,
      ).toBe('major');
    });

    it('priceZoneRequired (major) when not at a level', () => {
      const r = scorePlanAdherence(
        makeChecklist({ priceZone: { atSignificantLevel: false } }),
        makePlan(),
      )!;
      expect(
        r.violations.find((x) => x.rule === 'priceZoneRequired')?.severity,
      ).toBe('major');
    });

    it('timeConfluenceRequired is MINOR (not a ruleBreaker on its own)', () => {
      const r = scorePlanAdherence(
        makeChecklist({ timeConfluence: { inTimeZone: false } }),
        makePlan(),
      )!;
      const v = r.violations.find((x) => x.rule === 'timeConfluenceRequired');
      expect(v?.severity).toBe('minor');
      expect(r.ruleBreaker).toBe(false);
      // lost 15 of 100 → 85.
      expect(r.total).toBe(85);
    });

    it('stopPlacement (major) when declared logic differs from plan', () => {
      const r = scorePlanAdherence(
        makeChecklist({ stopPlacement: { logic: 'arbitrary' } }),
        makePlan({ stopRules: { placement: 'swing_extreme' } }),
      )!;
      expect(
        r.violations.find((x) => x.rule === 'stopPlacement')?.severity,
      ).toBe('major');
    });
  });

  it('custom plan stop placement always satisfies stop adherence', () => {
    const r = scorePlanAdherence(
      makeChecklist({ stopPlacement: { logic: 'arbitrary' } }),
      makePlan({ stopRules: { placement: 'custom' } }),
    )!;
    expect(
      r.violations.find((x) => x.rule === 'stopPlacement'),
    ).toBeUndefined();
  });

  it('only stop is checked (no entry conditions required) → 100 when stop matches', () => {
    const plan = makePlan({
      entryConditions: {
        requiresMomentumAlignment: false,
        requiresPattern: false,
        requiresPriceZone: false,
        requiresTimeConfluence: false,
      },
    });
    const r = scorePlanAdherence(
      makeChecklist({ momentum: { higherTfDirection: 'unclear' } }),
      plan,
    )!;
    expect(r.total).toBe(100);
    expect(r.violations).toHaveLength(0);
  });

  it('localizes violation messages in FR', () => {
    const r = scorePlanAdherence(
      makeChecklist({ pattern: { identified: false } }),
      makePlan(),
      'fr',
    )!;
    const v = r.violations.find((x) => x.rule === 'patternRequired');
    expect(v?.message).toContain('schéma');
  });

  it('localizes the templated stop-placement message in FR', () => {
    const r = scorePlanAdherence(
      makeChecklist({ stopPlacement: { logic: 'arbitrary' } }),
      makePlan({ stopRules: { placement: 'fixed_pips' } }),
      'fr',
    )!;
    const v = r.violations.find((x) => x.rule === 'stopPlacement');
    expect(v?.message).toContain('spécifie');
    expect(v?.message).toContain('fixed_pips');
  });
});
