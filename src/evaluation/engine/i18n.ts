/**
 * Localization for the Phase 2 evaluation engine's user-facing strings:
 * plan-adherence violation messages and behavioral-pattern metric strings.
 *
 * Mirrors the Phase 1 risk-engine i18n convention exactly (resolve + {en, fr,
 * es} maps keyed by stable English keys). `resolveLanguage` is reused from the
 * risk engine — there is one notion of "supported language" across the
 * backend.
 *
 * Logic keys (`rule`, pattern `type`) stay stable/English for audit and
 * detection; only the human-readable `message` / `metric` text is localized.
 * EN, FR, and ES are required.
 */

import { resolveLanguage, Language } from '../../risk/engine/i18n';
import { ViolationRule, StopPlacement, StopLogicDeclared } from './types';

export { resolveLanguage };
export type { Language };

// ─── Plan-adherence violation messages (spec Section 5.2) ─────────────────────
//
// `stopPlacement` is a template: it interpolates the plan's required placement
// and the trader's declared logic, so it is stored as a function.

type StaticViolationRule = Exclude<ViolationRule, 'stopPlacement'>;

const VIOLATION_MESSAGES: Record<
  Language,
  Record<StaticViolationRule, string>
> = {
  en: {
    momentumAlignment:
      'Your plan requires momentum alignment — higher TF direction unclear or lower TF reversal absent',
    patternRequired:
      'Your plan requires an identifiable pattern — none declared',
    priceZoneRequired:
      'Your plan requires entry at a significant price level — none declared',
    timeConfluenceRequired:
      'Your plan requires time confluence — entry is outside the time zone',
  },
  fr: {
    momentumAlignment:
      'Votre plan exige un alignement du momentum — direction du TF supérieur incertaine ou retournement du TF inférieur absent',
    patternRequired:
      "Votre plan exige un schéma identifiable — aucun n'a été déclaré",
    priceZoneRequired:
      "Votre plan exige une entrée à un niveau de prix significatif — aucun n'a été déclaré",
    timeConfluenceRequired:
      "Votre plan exige une confluence temporelle — l'entrée est hors de la fenêtre horaire",
  },
  es: {
    momentumAlignment:
      'Tu plan exige alineación de momentum — dirección poco clara en el marco superior o ausencia de reversión en el marco inferior',
    patternRequired:
      'Tu plan exige un patrón identificable — no se declaró ninguno',
    priceZoneRequired:
      'Tu plan exige una entrada en un nivel de precio significativo — no se declaró ninguno',
    timeConfluenceRequired:
      'Tu plan exige confluencia horaria — la entrada está fuera de la ventana horaria',
  },
};

const STOP_PLACEMENT_MESSAGE: Record<
  Language,
  (planned: StopPlacement, declared: StopLogicDeclared) => string
> = {
  en: (planned, declared) =>
    `Your plan specifies ${planned} stops — declared as ${declared}`,
  fr: (planned, declared) =>
    `Votre plan spécifie des stops ${planned} — déclaré comme ${declared}`,
  es: (planned, declared) =>
    `Tu plan especifica stops ${planned} — declarado como ${declared}`,
};

/** Localized message for a non-templated violation rule, falling back to EN. */
export function violationMessage(
  rule: StaticViolationRule,
  language: Language,
): string {
  return (
    VIOLATION_MESSAGES[language]?.[rule] ?? VIOLATION_MESSAGES.en[rule] ?? rule
  );
}

/** Localized stop-placement violation message (interpolates the two values). */
export function stopPlacementViolationMessage(
  planned: StopPlacement,
  declared: StopLogicDeclared,
  language: Language,
): string {
  return (STOP_PLACEMENT_MESSAGE[language] ?? STOP_PLACEMENT_MESSAGE.en)(
    planned,
    declared,
  );
}

// ─── Behavioral pattern metric strings (spec Section 8.2) ─────────────────────
//
// Each detector emits a `metric` — the specific number that triggered it. These
// templates localize that string. Keyed by the stable pattern `type`.

export interface PatternMetricParams {
  /** Generic percentage (0–100, already rounded) used by rate-based patterns. */
  pct?: number;
  /** Overall vs post-loss adherence (revenge_trading). */
  overall?: number;
  after?: number;
  /** Streak length (lucky_streak, rule_breaking_streak). */
  streak?: number;
  /** Day counts (overtrading). */
  exceededDays?: number;
  activeDays?: number;
  /** Trade count (stop_widening). */
  count?: number;
}

type MetricBuilder = (p: PatternMetricParams) => string;

const PATTERN_METRICS: Record<Language, Record<string, MetricBuilder>> = {
  en: {
    early_exit: (p) => `${p.pct}% of winning trades exited before target`,
    revenge_trading: (p) =>
      `Plan adherence drops from ${p.overall} to ${p.after} in the 4h after a loss`,
    lucky_streak: (p) =>
      `${p.streak} consecutive trades won despite rule violations`,
    inconsistent_sizing: (p) =>
      `${p.pct}% of trades sized more than 20% away from the Risk Engine recommendation`,
    overtrading: (p) =>
      `Exceeded the daily trade limit on ${p.exceededDays} of ${p.activeDays} active trading days`,
    stop_widening: (p) =>
      `${p.count} trades had a stop moved further from entry after opening`,
    rule_breaking_streak: (p) =>
      `${p.streak} consecutive trades with a major plan violation`,
    chasing_entries: (p) =>
      `${p.pct}% of objective-trigger trades entered beyond the declared trigger`,
    weak_setup_bias: (p) =>
      `${p.pct}% of trades scored below 55 on setup quality`,
  },
  fr: {
    early_exit: (p) =>
      `${p.pct}% des trades gagnants ont été clôturés avant l'objectif`,
    revenge_trading: (p) =>
      `Le respect du plan chute de ${p.overall} à ${p.after} dans les 4h après une perte`,
    lucky_streak: (p) =>
      `${p.streak} trades consécutifs gagnés malgré des violations de règles`,
    inconsistent_sizing: (p) =>
      `${p.pct}% des trades dimensionnés à plus de 20% de la recommandation du moteur de risque`,
    overtrading: (p) =>
      `Limite quotidienne de trades dépassée sur ${p.exceededDays} des ${p.activeDays} jours de trading actifs`,
    stop_widening: (p) =>
      `${p.count} trades avec un stop éloigné de l'entrée après l'ouverture`,
    rule_breaking_streak: (p) =>
      `${p.streak} trades consécutifs avec une violation majeure du plan`,
    chasing_entries: (p) =>
      `${p.pct}% des trades à déclencheur objectif sont entrés au-delà du déclencheur déclaré`,
    weak_setup_bias: (p) =>
      `${p.pct}% des trades ont obtenu un score de qualité de setup inférieur à 55`,
  },
  es: {
    early_exit: (p) =>
      `${p.pct}% de las operaciones ganadoras se cerraron antes del objetivo`,
    revenge_trading: (p) =>
      `El apego al plan cae de ${p.overall} a ${p.after} en las 4h posteriores a una pérdida`,
    lucky_streak: (p) =>
      `${p.streak} operaciones consecutivas ganadas a pesar de infracciones de reglas`,
    inconsistent_sizing: (p) =>
      `${p.pct}% de las operaciones dimensionadas con más de un 20% de desviación respecto a la recomendación del motor de riesgo`,
    overtrading: (p) =>
      `Se superó el límite diario de operaciones en ${p.exceededDays} de ${p.activeDays} días de trading activos`,
    stop_widening: (p) =>
      `${p.count} operaciones tuvieron un stop movido más lejos de la entrada después de abrir`,
    rule_breaking_streak: (p) =>
      `${p.streak} operaciones consecutivas con una infracción grave del plan`,
    chasing_entries: (p) =>
      `${p.pct}% de las operaciones con disparador objetivo entraron más allá del disparador declarado`,
    weak_setup_bias: (p) =>
      `${p.pct}% de las operaciones obtuvieron una calidad de configuración por debajo de 55`,
  },
};

/** Localized metric string for a behavioral pattern, falling back to EN. */
export function patternMetric(
  type: string,
  params: PatternMetricParams,
  language: Language,
): string {
  const builder = PATTERN_METRICS[language]?.[type] ?? PATTERN_METRICS.en[type];
  return builder ? builder(params) : type;
}
