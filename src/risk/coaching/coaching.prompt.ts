import { Language } from '../engine';
import { getCurrencySymbol } from '../../constants/currency';
import { CoachingContext, CoachingPromptParts } from './coaching.interface';

/**
 * Builds the coaching prompt (spec §6/§15). Pure and deterministic — the model
 * only ever explains numbers the engine already computed; it never recalculates.
 * Output language follows the user's `language`.
 */

const SYSTEM_PROMPTS: Record<Language, string> = {
  en: [
    'You are the trading discipline coach for Zenlot.',
    'Explain risk-calculation results to traders in plain, direct language.',
    'You never produce numbers yourself — all numbers come from the system context.',
    'Rules:',
    '- Never recalculate anything. If a number looks wrong, say "the system shows X" and flag it.',
    '- Keep coaching under 80 words unless a circuit breaker is triggered.',
    '- When a trade is blocked, lead with the blocking reason, then say what would need to change for approval.',
    '- When approved, confirm it and note any warnings briefly.',
    '- Treat an 80%-of-limit warning as a heads-up, not a red flag.',
    "- Use the trader's account-currency symbol, not generic dollar signs.",
    '- Respond in plain text only. Do not use markdown, headings, asterisks, backticks, or bullet characters.',
    'Respond in English.',
  ].join('\n'),
  fr: [
    'Vous êtes le coach de discipline de trading de Zenlot.',
    'Expliquez les résultats du calcul de risque aux traders dans un langage clair et direct.',
    'Vous ne produisez jamais de chiffres vous-même — tous les chiffres proviennent du contexte système.',
    'Règles :',
    '- Ne recalculez jamais rien. Si un chiffre semble erroné, dites « le système indique X » et signalez-le.',
    '- Limitez le coaching à moins de 80 mots, sauf si un coupe-circuit est déclenché.',
    "- Lorsqu'un trade est bloqué, commencez par la raison du blocage, puis indiquez ce qui devrait changer pour l'approbation.",
    "- Lorsqu'il est approuvé, confirmez-le et mentionnez brièvement les avertissements.",
    "- Traitez un avertissement à 80 % d'une limite comme une information, pas une alerte.",
    '- Utilisez le symbole de la devise du compte du trader.',
    '- Répondez en texte brut uniquement. N\'utilisez pas de markdown, de titres, d\'astérisques, de backticks ni de puces.',
    'Répondez en français.',
  ].join('\n'),
};

export function buildCoachingPrompt(
  context: CoachingContext,
  language: Language,
): CoachingPromptParts {
  const { calculation: c, governance: g } = context;
  const sym = getCurrencySymbol(context.accountCurrency);

  const lines: string[] = [];
  if (g.blockedReason) lines.push(`BLOCKED: ${g.blockedReason}.`);
  lines.push(`Overall governance status: ${g.overallStatus}.`);
  lines.push(`Trade: ${c.symbol} ${c.execution}.`);
  lines.push(`Position size: ${c.lotSizeRounded} lots.`);
  lines.push(
    `Capital exposure: ${sym}${c.actualCapitalExposure.toFixed(2)} (${c.capitalExposurePct.toFixed(2)}% of account).`,
  );
  lines.push(`Stop distance: ${c.stopDistancePips.toFixed(1)} pips.`);
  if (c.rewardToRisk !== null) {
    lines.push(`Reward-to-risk: ${c.rewardToRisk.toFixed(2)}.`);
  }

  const notable = g.checks.filter(
    (ch) => !ch.informational && ch.status !== 'approved',
  );
  if (notable.length > 0) {
    const detail = notable
      .map(
        (ch) =>
          `${ch.message} (${ch.status}, ${ch.actual.toFixed(2)} vs limit ${ch.limit})`,
      )
      .join('; ');
    lines.push(`Checks needing attention: ${detail}.`);
  }

  return { system: SYSTEM_PROMPTS[language], user: lines.join('\n') };
}
