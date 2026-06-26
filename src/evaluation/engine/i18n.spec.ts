import {
  patternMetric,
  resolveLanguage,
  stopPlacementViolationMessage,
  violationMessage,
} from './i18n';

describe('resolveLanguage', () => {
  it('normalizes supported languages and falls back to en', () => {
    expect(resolveLanguage('fr')).toBe('fr');
    expect(resolveLanguage('FR')).toBe('fr');
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('es')).toBe('en');
    expect(resolveLanguage(null)).toBe('en');
    expect(resolveLanguage(undefined)).toBe('en');
  });
});

describe('violationMessage', () => {
  it('resolves EN and FR for each static rule', () => {
    expect(violationMessage('patternRequired', 'en')).toContain('pattern');
    expect(violationMessage('patternRequired', 'fr')).toContain('schéma');
    expect(violationMessage('momentumAlignment', 'en')).toContain('momentum');
    expect(violationMessage('momentumAlignment', 'fr')).toContain('momentum');
    expect(violationMessage('priceZoneRequired', 'fr')).toContain(
      'niveau de prix',
    );
    expect(violationMessage('timeConfluenceRequired', 'fr')).toContain(
      'confluence',
    );
  });
});

describe('stopPlacementViolationMessage', () => {
  it('interpolates planned + declared in EN and FR', () => {
    const en = stopPlacementViolationMessage(
      'swing_extreme',
      'arbitrary',
      'en',
    );
    expect(en).toContain('swing_extreme');
    expect(en).toContain('arbitrary');
    const fr = stopPlacementViolationMessage('fixed_pips', 'arbitrary', 'fr');
    expect(fr).toContain('spécifie');
    expect(fr).toContain('fixed_pips');
  });
});

describe('patternMetric', () => {
  it('builds EN strings for each pattern type', () => {
    expect(patternMetric('early_exit', { pct: 50 }, 'en')).toContain('50%');
    expect(
      patternMetric('revenge_trading', { overall: 90, after: 60 }, 'en'),
    ).toContain('90');
    expect(patternMetric('lucky_streak', { streak: 4 }, 'en')).toContain('4');
    expect(patternMetric('inconsistent_sizing', { pct: 33 }, 'en')).toContain(
      '33%',
    );
    expect(
      patternMetric('overtrading', { exceededDays: 2, activeDays: 5 }, 'en'),
    ).toContain('2');
    expect(patternMetric('stop_widening', { count: 3 }, 'en')).toContain('3');
    expect(
      patternMetric('rule_breaking_streak', { streak: 3 }, 'en'),
    ).toContain('3');
    expect(patternMetric('chasing_entries', { pct: 60 }, 'en')).toContain(
      '60%',
    );
    expect(patternMetric('weak_setup_bias', { pct: 70 }, 'en')).toContain(
      '70%',
    );
  });

  it('builds FR strings and falls back to EN for unknown types', () => {
    expect(patternMetric('early_exit', { pct: 50 }, 'fr')).toContain(
      "l'objectif",
    );
    expect(patternMetric('lucky_streak', { streak: 4 }, 'fr')).toContain(
      'consécutifs',
    );
    // Unknown type → returns the type key itself.
    expect(patternMetric('nonexistent', {}, 'en')).toBe('nonexistent');
  });
});
