import { buildBehavioralReportContent } from './notification.copy';
import { NotificationCategory } from './notification.types';

describe('buildBehavioralReportContent', () => {
  const data = {
    category: NotificationCategory.BehavioralReport,
    reportId: 'r1',
  };

  it('builds pattern-specific English copy', () => {
    const c = buildBehavioralReportContent('revenge_trading', 'en', {
      ...data,
    });
    expect(c.category).toBe(NotificationCategory.BehavioralReport);
    expect(c.urgency).toBe('gentle');
    expect(c.title).toBe('Your weekly trading review is ready');
    expect(c.body).toContain('revenge trading after losses');
  });

  it('builds pattern-specific French copy', () => {
    const c = buildBehavioralReportContent('overtrading', 'fr', { ...data });
    expect(c.title).toContain('bilan hebdomadaire');
    expect(c.body).toContain('surtrading');
  });

  it('builds pattern-specific Spanish copy', () => {
    const c = buildBehavioralReportContent('overtrading', 'es', { ...data });
    expect(c.title).toContain('resumen semanal');
    expect(c.body).toContain('sobreoperar');
  });

  it.each([
    ['es-419', 'sobreoperar'],
    ['es_MX', 'sobreoperar'],
  ])('resolves the regional tag %s to Spanish copy', (locale, expected) => {
    const c = buildBehavioralReportContent('overtrading', locale, { ...data });
    expect(c.body).toContain(expected);
  });

  it.each([['est'], ['fry']])(
    'does not treat the lookalike tag %s as fr/es',
    (locale) => {
      const c = buildBehavioralReportContent('overtrading', locale, {
        ...data,
      });
      expect(c.title).toBe('Your weekly trading review is ready');
    },
  );

  it('falls back to the generic copy when no top-priority pattern', () => {
    const c = buildBehavioralReportContent(null, 'en', { ...data });
    expect(c.body).toContain('A new behavioral pattern was detected');
  });

  it('falls back to English for an unknown locale', () => {
    const c = buildBehavioralReportContent('early_exit', 'de', { ...data });
    expect(c.body).toContain('exiting winners early');
  });
});
