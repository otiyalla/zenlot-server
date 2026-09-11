/**
 * Localization for engine-produced, user-facing strings (governance check
 * labels). The platform's supported languages are driven by `user.language`;
 * today that's English, French, and Spanish, expandable over time — add a new
 * entry to `Language` and each table below to support another locale.
 *
 * Mirrors the backend's existing email i18n convention (resolve + {en, fr, es}
 * map). `rule` keys stay stable/English for logic and audit; only `message` is
 * localized.
 */

export type Language = 'en' | 'fr' | 'es';

const SUPPORTED_LANGUAGES: Language[] = ['en', 'fr', 'es'];
const DEFAULT_LANGUAGE: Language = 'en';

/** Normalizes an arbitrary language string to a supported Language (fallback en). */
export function resolveLanguage(language: string | null | undefined): Language {
  const normalized = String(language ?? '')
    .trim()
    .toLowerCase();
  return (SUPPORTED_LANGUAGES as string[]).includes(normalized)
    ? (normalized as Language)
    : DEFAULT_LANGUAGE;
}

/** Plain-language governance check labels, keyed by the stable `rule` id. */
const GOVERNANCE_MESSAGES: Record<Language, Record<string, string>> = {
  en: {
    maxRiskPerTrade: 'Capital exposure per trade',
    maxPortfolioExposure: 'Total portfolio exposure after this trade',
    maxOpenTrades: 'Open trade count',
    dailyDrawdown: 'Daily drawdown',
    weeklyDrawdown: 'Weekly drawdown',
    monthlyDrawdown: 'Monthly drawdown',
    maxCorrelatedExposure: 'Combined exposure on correlated pairs',
    minRewardToRisk: 'Reward-to-risk ratio',
  },
  fr: {
    maxRiskPerTrade: 'Exposition du capital par trade',
    maxPortfolioExposure: 'Exposition totale du portefeuille après ce trade',
    maxOpenTrades: 'Nombre de trades ouverts',
    dailyDrawdown: 'Drawdown quotidien',
    weeklyDrawdown: 'Drawdown hebdomadaire',
    monthlyDrawdown: 'Drawdown mensuel',
    maxCorrelatedExposure: 'Exposition combinée sur les paires corrélées',
    minRewardToRisk: 'Ratio rendement/risque',
  },
  es: {
    maxRiskPerTrade: 'Exposición de capital por operación',
    maxPortfolioExposure: 'Exposición total de la cartera tras esta operación',
    maxOpenTrades: 'Número de operaciones abiertas',
    dailyDrawdown: 'Drawdown diario',
    weeklyDrawdown: 'Drawdown semanal',
    monthlyDrawdown: 'Drawdown mensual',
    maxCorrelatedExposure: 'Exposición combinada en pares correlacionados',
    minRewardToRisk: 'Relación recompensa-riesgo',
  },
};

/** Localized label for a governance rule, falling back to English then the key. */
export function governanceMessage(rule: string, language: Language): string {
  return (
    GOVERNANCE_MESSAGES[language]?.[rule] ??
    GOVERNANCE_MESSAGES[DEFAULT_LANGUAGE][rule] ??
    rule
  );
}
