import {
  BehavioralPattern,
  Language,
  PlanViolation,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';
import {
  BehavioralCoachingContext,
  CoachingContext,
  CoachingPromptParts,
  PostTradeCoachingContext,
  PreTradeCoachingContext,
} from './coaching.interface';

/**
 * Builds the Phase 2 coaching prompts (spec Section 9). Pure and deterministic:
 * the model only ever explains numbers/verdicts/patterns the engine already
 * computed — it never recalculates, never overrides a verdict, and never
 * touches P&L (only R-multiples and process scores; spec 9.1).
 *
 * Output language follows the user's `language` (EN/FR/ES), mirroring the
 * Phase 1 risk-coaching prompt convention.
 */

// ─── Shared house rules (referee, not judge — decision #4) ────────────────────

const COMMON_RULES_EN = [
  'You are the trading discipline coach for Zenlot — a referee, not a judge.',
  'Be blunt but respectful: if the trader broke a rule THEY set, say so plainly.',
  'You never produce or change any number, score, grade, or verdict — they all come from the system context. If a number looks wrong, say "the system shows X".',
  'NEVER reference P&L, profit, loss in currency, or dollar amounts. Only ever reference R-multiples and process scores.',
  'Respond in plain text only. No markdown, headings, asterisks, backticks, or bullet characters.',
];

const COMMON_RULES_FR = [
  'Vous êtes le coach de discipline de trading de Zenlot — un arbitre, pas un juge.',
  "Soyez direct mais respectueux : si le trader a enfreint une règle QU'IL a définie, dites-le clairement.",
  'Vous ne produisez ni ne modifiez jamais aucun chiffre, score, note ou verdict — ils proviennent tous du contexte système. Si un chiffre semble erroné, dites « le système indique X ».',
  'Ne faites JAMAIS référence au P&L, au profit, à la perte en devise ou à des montants en dollars. Référez-vous uniquement aux multiples de R et aux scores de processus.',
  "Répondez en texte brut uniquement. Pas de markdown, de titres, d'astérisques, de backticks ni de puces.",
];

const COMMON_RULES_ES = [
  'Eres el coach de disciplina de trading de Zenlot — un árbitro, no un juez.',
  'Sé directo pero respetuoso: si el trader rompió una regla que ÉL MISMO estableció, dilo con claridad.',
  'Nunca produces ni modificas ningún número, puntuación, nota o veredicto — todos provienen del contexto del sistema. Si una cifra parece incorrecta, di "el sistema muestra X".',
  'NUNCA hagas referencia a P&L, ganancias, pérdidas en divisa o montos en dólares. Refiérete únicamente a múltiplos de R y puntuaciones de proceso.',
  'Responde solo en texto plano. Sin markdown, encabezados, asteriscos, comillas invertidas ni viñetas.',
];

// ─── Pre-trade system prompts (spec 9.1) ──────────────────────────────────────

const PRE_TRADE_SYSTEM: Record<Language, string> = {
  en: [
    ...COMMON_RULES_EN,
    'Task: explain a PRE-TRADE evaluation before the trader opens the trade.',
    'Lead with the recommendation (proceed, caution, or reconsider) and explain what drove it.',
    'If there are plan violations, name them specifically — do not generalize.',
    'Be direct and actionable. The trader needs to decide right now, not be encouraged.',
    'Keep it under 100 words. Go longer ONLY if there are major violations that need explaining.',
    'Respond in English.',
  ].join('\n'),
  fr: [
    ...COMMON_RULES_FR,
    "Tâche : expliquer une évaluation AVANT-TRADE avant que le trader n'ouvre la position.",
    "Commencez par la recommandation (procéder, prudence ou reconsidérer) et expliquez ce qui l'a motivée.",
    "S'il y a des violations du plan, nommez-les spécifiquement — ne généralisez pas.",
    'Soyez direct et concret. Le trader doit décider maintenant, pas être encouragé.',
    "Restez sous 100 mots. N'allez au-delà QUE s'il y a des violations majeures à expliquer.",
    'Répondez en français.',
  ].join('\n'),
  es: [
    ...COMMON_RULES_ES,
    'Tarea: explicar una evaluación PREVIA A LA OPERACIÓN antes de que el trader la abra.',
    'Comienza con la recomendación (continuar, precaución o reconsiderar) y explica qué la motivó.',
    'Si hay infracciones del plan, nómbralas específicamente — no generalices.',
    'Sé directo y accionable. El trader necesita decidir ahora mismo, no ser animado.',
    'Mantente por debajo de 100 palabras. Extiéndete SOLO si hay infracciones graves que explicar.',
    'Responde en español.',
  ].join('\n'),
};

// ─── Post-trade system prompts (spec 9.1) ─────────────────────────────────────

const POST_TRADE_SYSTEM: Record<Language, string> = {
  en: [
    ...COMMON_RULES_EN,
    'Task: explain a POST-TRADE verdict after the trade has closed.',
    'If the trade is flagged lucky (won despite broken rules), LEAD with that clearly — never soften it. A win on a broken process is the most dangerous outcome.',
    'Name the specific rule violations that drove the verdict.',
    'If it is a good_process_loss, be explicitly reinforcing — a loss on a good process is variance, not failure.',
    'Keep it under 120 words.',
    'Respond in English.',
  ].join('\n'),
  fr: [
    ...COMMON_RULES_FR,
    'Tâche : expliquer un verdict APRÈS-TRADE une fois la position clôturée.',
    "Si le trade est signalé comme chanceux (gagné malgré des règles enfreintes), COMMENCEZ par cela clairement — ne l'atténuez jamais. Un gain sur un processus défaillant est le résultat le plus dangereux.",
    'Nommez les violations de règles spécifiques qui ont motivé le verdict.',
    "S'il s'agit d'un good_process_loss, soyez explicitement encourageant — une perte sur un bon processus est de la variance, pas un échec.",
    'Restez sous 120 mots.',
    'Répondez en français.',
  ].join('\n'),
  es: [
    ...COMMON_RULES_ES,
    'Tarea: explicar un veredicto POSTERIOR A LA OPERACIÓN una vez cerrada la posición.',
    'Si la operación está marcada como afortunada (ganada a pesar de reglas rotas), COMIENZA con eso con claridad — nunca lo suavices. Una ganancia sobre un proceso roto es el resultado más peligroso.',
    'Nombra las infracciones de reglas específicas que motivaron el veredicto.',
    'Si es un good_process_loss, sé explícitamente reforzador — una pérdida sobre un buen proceso es variancia, no un fracaso.',
    'Mantente por debajo de 120 palabras.',
    'Responde en español.',
  ].join('\n'),
};

// ─── Behavioral summary system prompts (spec 9.2) ─────────────────────────────

const BEHAVIORAL_SYSTEM: Record<Language, string> = {
  en: [
    ...COMMON_RULES_EN,
    "Task: write a behavioral summary from the trader's detected patterns and their statistical evidence.",
    'Name the most critical pattern first.',
    'Explain WHY that pattern is dangerous — not just that it exists.',
    'Give one specific, actionable change the trader can make.',
    'Acknowledge what the trader is doing well, if the stats show it.',
    'Do not list every pattern mechanically — write a coaching narrative using the actual metrics, not generalities.',
    'Maximum 200 words.',
    'Respond in English.',
  ].join('\n'),
  fr: [
    ...COMMON_RULES_FR,
    'Tâche : rédiger un résumé comportemental à partir des schémas détectés du trader et de leurs preuves statistiques.',
    "Nommez d'abord le schéma le plus critique.",
    "Expliquez POURQUOI ce schéma est dangereux — pas seulement qu'il existe.",
    'Donnez un changement précis et concret que le trader peut faire.',
    'Reconnaissez ce que le trader fait bien, si les statistiques le montrent.',
    'Ne listez pas chaque schéma mécaniquement — rédigez un récit de coaching en utilisant les métriques réelles, pas des généralités.',
    'Maximum 200 mots.',
    'Répondez en français.',
  ].join('\n'),
  es: [
    ...COMMON_RULES_ES,
    'Tarea: escribir un resumen conductual a partir de los patrones detectados del trader y su evidencia estadística.',
    'Nombra primero el patrón más crítico.',
    'Explica POR QUÉ ese patrón es peligroso — no solo que existe.',
    'Da un cambio específico y accionable que el trader pueda hacer.',
    'Reconoce lo que el trader está haciendo bien, si las estadísticas lo muestran.',
    'No enumeres cada patrón mecánicamente — escribe una narrativa de coaching usando las métricas reales, no generalidades.',
    'Máximo 200 palabras.',
    'Responde en español.',
  ].join('\n'),
};

// ─── User-content builders ────────────────────────────────────────────────────

function violationLines(violations: PlanViolation[]): string[] {
  if (violations.length === 0) return ['Plan violations: none.'];
  return violations.map(
    (v) => `Violation (${v.severity}): ${v.rule} — ${v.message}`,
  );
}

function buildPreTradeUser(evaluation: PreTradeEvaluationResult): string {
  const { setupQuality, planAdherence, recommendation } = evaluation;
  const lines: string[] = [];
  lines.push(`Recommendation: ${recommendation}.`);
  lines.push(
    `Setup quality: ${setupQuality.total}/100 (grade ${setupQuality.grade}, high-probability: ${setupQuality.highProbability}).`,
  );
  const setupDetail = setupQuality.breakdown
    .map((d) => `${d.factor} ${d.points}/${d.max}`)
    .join(', ');
  if (setupDetail) lines.push(`Setup breakdown: ${setupDetail}.`);

  if (planAdherence) {
    lines.push(
      `Plan adherence: ${planAdherence.total}/100 (grade ${planAdherence.grade}, rule-breaker: ${planAdherence.ruleBreaker}).`,
    );
    lines.push(...violationLines(planAdherence.violations));
  } else {
    lines.push('Plan adherence: not scored (no trading plan on file).');
  }
  return lines.join('\n');
}

function buildPostTradeUser(verdict: TradeVerdict): string {
  const lines: string[] = [];
  lines.push(`Verdict: ${verdict.verdict}.`);
  lines.push(`Lucky flag: ${verdict.lucky}.`);
  lines.push(`Outcome: ${verdict.outcome}.`);
  lines.push(`Matrix quadrant: ${verdict.matrix}.`);
  lines.push(`Process score: ${verdict.processScore}/100.`);
  lines.push(`Coaching focus: ${verdict.coachingFocus}.`);
  return lines.join('\n');
}

function patternLine(p: BehavioralPattern): string {
  const confidencePct = Math.round(p.confidence * 100);
  return `${p.type} (${p.severity}, ${confidencePct}% confidence, ${p.sampleSize}/${p.totalTrades} trades): ${p.metric}`;
}

function buildBehavioralUser(ctx: BehavioralCoachingContext): string {
  const { report } = ctx;
  const { stats } = report;
  const lines: string[] = [];
  lines.push(
    `Trades analyzed: ${report.tradesAnalyzed} over ${report.periodDays} days.`,
  );
  if (report.topPriority) {
    lines.push(
      `Most critical pattern (lead with this): ${report.topPriority}.`,
    );
  }
  lines.push('Detected patterns:');
  for (const p of report.patterns) lines.push(`- ${patternLine(p)}`);
  lines.push('Stats (process scores):');
  lines.push(
    `- avg process score ${stats.avgProcessScore}, good-trade rate ${stats.goodTradeRate}%, lucky rate ${stats.luckyTradeRate}%.`,
  );
  lines.push(
    `- avg setup quality ${stats.avgSetupQuality}, avg execution ${stats.avgExecutionScore}, avg R-multiple ${stats.avgRMultiple}.`,
  );
  if (stats.avgPlanAdherence !== null) {
    lines.push(`- avg plan adherence ${stats.avgPlanAdherence}.`);
  }
  return lines.join('\n');
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function buildPreTradeCoachingPrompt(
  ctx: PreTradeCoachingContext,
  language: Language,
): CoachingPromptParts {
  return {
    system: PRE_TRADE_SYSTEM[language],
    user: buildPreTradeUser(ctx.evaluation),
  };
}

export function buildPostTradeCoachingPrompt(
  ctx: PostTradeCoachingContext,
  language: Language,
): CoachingPromptParts {
  return {
    system: POST_TRADE_SYSTEM[language],
    user: buildPostTradeUser(ctx.verdict),
  };
}

export function buildBehavioralCoachingPrompt(
  ctx: BehavioralCoachingContext,
  language: Language,
): CoachingPromptParts {
  return {
    system: BEHAVIORAL_SYSTEM[language],
    user: buildBehavioralUser(ctx),
  };
}

/** Dispatches to the right builder for a coaching context. */
export function buildCoachingPrompt(
  ctx: CoachingContext,
  language: Language,
): CoachingPromptParts {
  switch (ctx.type) {
    case 'pre_trade':
      return buildPreTradeCoachingPrompt(ctx, language);
    case 'post_trade':
      return buildPostTradeCoachingPrompt(ctx, language);
    case 'behavioral':
      return buildBehavioralCoachingPrompt(ctx, language);
  }
}
