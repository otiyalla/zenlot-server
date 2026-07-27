import {
  NotificationCategory,
  NotificationContent,
  NotificationLocale,
} from './notification.types';

/**
 * Notification copy (en + fr).
 *
 * Tone guide — this is a trading-psychology product, not a casino. The trader's
 * money and discipline are on the line, so:
 *  - Wins are acknowledged calmly (no confetti, no "🚀 to the moon"), because
 *    over-celebrating wins trains the same dopamine loop that hurts traders.
 *  - Losses, drawdown and governance breaches are framed as protective and
 *    supportive — "your risk system did its job" — never punitive or shaming.
 *  - Reminders are gentle invitations, not nags.
 *  - Emoji are used sparingly and inclusively (no gendered/skin-toned emoji);
 *    a single calm marker at most, and never on loss/breach copy.
 *
 * Every string is provided in both supported locales. `localize` falls back to
 * 'en' for unknown locales (mirrors the app's i18n enableFallback behaviour).
 */

const resolveLocale = (locale?: string): NotificationLocale =>
  locale?.toLowerCase().startsWith('fr') ? 'fr' : 'en';

// Notification body shown in the tray; kept short so it reads well collapsed.
const COACHING_BODY_MAX = 220;
// Full coaching carried in the data payload (re-surfaced on tap). Capped to stay
// well under the ~4KB APNs/FCM push payload limit.
const COACHING_DATA_MAX = 2500;

/**
 * Lightweight markdown/whitespace cleanup for notification surfaces. The coach
 * model is prompted for plain text but output is non-deterministic, so we strip
 * the tokens it actually emits (mirrors the client's stripMarkdown) and collapse
 * whitespace into a single line suitable for a notification.
 */
const toPlainText = (input: string): string =>
  input
    .replace(/```[^\n]*\n?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** Formats a signed money amount, e.g. +$123.45 / -€80.00. */
export const formatSignedAmount = (
  amount: number,
  currency: string,
  locale: NotificationLocale,
): string => {
  const code = (currency || 'USD').toUpperCase();
  const intlLocale = locale === 'fr' ? 'fr-FR' : 'en-US';
  try {
    const formatted = new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency: code,
      signDisplay: 'always',
    }).format(amount);
    return formatted;
  } catch {
    // Unknown currency code — fall back to a plain signed number with the code.
    const sign = amount >= 0 ? '+' : '-';
    return `${sign}${Math.abs(amount).toFixed(2)} ${code}`;
  }
};

export interface TradeClosedCopyInput {
  symbol: string;
  pnl: number;
  accountCurrency: string;
  /** 'reached_tp' | 'reached_sl' — drives profit/loss framing. */
  closedReason: string;
}

/** "EURUSD closed in profit +$123.45" — calm, factual. */
export function buildTradeClosedContent(
  input: TradeClosedCopyInput,
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const isProfit = input.pnl >= 0;
  const symbol = input.symbol.toUpperCase();
  const amount = formatSignedAmount(input.pnl, input.accountCurrency, locale);

  const copy = {
    en: {
      profitTitle: `${symbol} hit your target`,
      lossTitle: `${symbol} hit your stop`,
      profitBody: `Closed in profit ${amount}. Logged to your journal — note what worked.`,
      lossBody: `Closed at your stop ${amount}. Your plan capped the loss — that's the system working.`,
    },
    fr: {
      profitTitle: `${symbol} a atteint votre objectif`,
      lossTitle: `${symbol} a atteint votre stop`,
      profitBody: `Clôturé en profit ${amount}. Enregistré dans votre journal — notez ce qui a marché.`,
      lossBody: `Clôturé au stop ${amount}. Votre plan a limité la perte — c'est le système qui fonctionne.`,
    },
  }[locale];

  return {
    category: NotificationCategory.TradeClosed,
    urgency: 'urgent',
    title: isProfit ? copy.profitTitle : copy.lossTitle,
    body: isProfit ? copy.profitBody : copy.lossBody,
    data,
  };
}

/**
 * AI coaching ready — gentle, invites reflection.
 *
 * The coaching text itself is the most useful payload: it becomes the
 * notification body (so the trader can read it straight from the tray, where it
 * persists — unlike the ephemeral in-app toast) and the full text also rides in
 * `data.coaching` so a tap can re-surface all of it. When no coaching text is
 * available we fall back to the generic "your coaching is ready" prompt.
 */
export function buildCoachingReadyContent(
  symbol: string | undefined,
  coaching: string | undefined,
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const sym = symbol?.toUpperCase();
  const plain = coaching ? toPlainText(coaching) : '';
  const copy = {
    en: {
      title: 'Your coaching is ready',
      fallback: sym
        ? `A few reflections on your ${sym} trade are waiting. Take a look when you have a moment.`
        : 'A few reflections on your latest trade are waiting. Take a look when you have a moment.',
    },
    fr: {
      title: 'Votre coaching est prêt',
      fallback: sym
        ? `Quelques réflexions sur votre trade ${sym} vous attendent. Jetez-y un œil dès que possible.`
        : 'Quelques réflexions sur votre dernier trade vous attendent. Jetez-y un œil dès que possible.',
    },
  }[locale];

  return {
    category: NotificationCategory.CoachingReady,
    urgency: 'gentle',
    title: copy.title,
    body: plain ? truncate(plain, COACHING_BODY_MAX) : copy.fallback,
    data: plain
      ? { ...data, coaching: truncate(plain, COACHING_DATA_MAX) }
      : data,
  };
}

export type DrawdownPeriod = 'daily' | 'weekly' | 'monthly';

/** Drawdown circuit breaker tripped — protective framing, never alarmist. */
export function buildDrawdownAlertContent(
  period: DrawdownPeriod,
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const periodWord = {
    en: { daily: 'daily', weekly: 'weekly', monthly: 'monthly' },
    fr: { daily: 'journalière', weekly: 'hebdomadaire', monthly: 'mensuelle' },
  }[locale][period];

  const copy = {
    en: {
      title: `Your ${periodWord} risk limit was reached`,
      body: `Your circuit breaker did its job and flagged the ${periodWord} drawdown. Consider stepping back and reviewing before the next trade.`,
    },
    fr: {
      title: `Votre limite de risque ${periodWord} est atteinte`,
      body: `Votre coupe-circuit a fait son travail et a signalé le drawdown ${periodWord}. Pensez à faire une pause et à revoir votre plan avant le prochain trade.`,
    },
  }[locale];

  return {
    category: NotificationCategory.DrawdownAlert,
    urgency: 'urgent',
    title: copy.title,
    body: copy.body,
    data,
  };
}

/** Governance / rule violation — informative and non-judgemental. */
export function buildGovernanceAlertContent(
  symbol: string | undefined,
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const sym = symbol?.toUpperCase();
  const copy = {
    en: {
      title: 'A trade broke one of your rules',
      body: sym
        ? `Your ${sym} trade went against a rule you set. It's logged so you can reflect on it later — no judgement.`
        : `Your latest trade went against a rule you set. It's logged so you can reflect on it later — no judgement.`,
    },
    fr: {
      title: 'Un trade a enfreint une de vos règles',
      body: sym
        ? `Votre trade ${sym} est allé à l'encontre d'une règle que vous avez définie. C'est enregistré pour que vous puissiez y réfléchir plus tard — sans jugement.`
        : `Votre dernier trade est allé à l'encontre d'une règle que vous avez définie. C'est enregistré pour que vous puissiez y réfléchir plus tard — sans jugement.`,
    },
  }[locale];

  return {
    category: NotificationCategory.GovernanceAlert,
    urgency: 'gentle',
    title: copy.title,
    body: copy.body,
    data,
  };
}

/** Journaling / discipline reminder — a gentle invitation, never a nag. */
export function buildJournalReminderContent(
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const copy = {
    en: {
      title: 'A moment for your journal',
      body: 'Two minutes of reflection compounds. How did your trading feel today?',
    },
    fr: {
      title: 'Un instant pour votre journal',
      body: 'Deux minutes de réflexion, ça compte. Comment s’est passé votre trading aujourd’hui ?',
    },
  }[locale];

  return {
    category: NotificationCategory.JournalReminder,
    urgency: 'gentle',
    title: copy.title,
    body: copy.body,
    data,
  };
}

/**
 * Stable behavioral-pattern keys (mirror the engine's BehavioralPatternType).
 * Kept local so the notification layer does not depend on the evaluation engine.
 */
export type BehavioralPatternKey =
  | 'early_exit'
  | 'stop_widening'
  | 'revenge_trading'
  | 'overtrading'
  | 'rule_breaking_streak'
  | 'inconsistent_sizing'
  | 'lucky_streak'
  | 'chasing_entries'
  | 'weak_setup_bias';

/**
 * Short, calm human label for each behavioral pattern, used inside the weekly
 * review push so the copy is pattern-specific (spec 13.3) rather than generic.
 */
const PATTERN_LABEL: Record<
  NotificationLocale,
  Record<BehavioralPatternKey, string>
> = {
  en: {
    early_exit: 'exiting winners early',
    stop_widening: 'widening your stops',
    revenge_trading: 'revenge trading after losses',
    overtrading: 'overtrading',
    rule_breaking_streak: 'a streak of rule-breaking trades',
    inconsistent_sizing: 'inconsistent position sizing',
    lucky_streak: 'wins despite breaking your rules',
    chasing_entries: 'chasing entries',
    weak_setup_bias: 'a bias toward weak setups',
  },
  fr: {
    early_exit: 'la sortie anticipée des trades gagnants',
    stop_widening: "l'élargissement de vos stops",
    revenge_trading: 'le trading de revanche après les pertes',
    overtrading: 'le surtrading',
    rule_breaking_streak: 'une série de trades enfreignant vos règles',
    inconsistent_sizing: 'un dimensionnement de position incohérent',
    lucky_streak: 'des gains malgré le non-respect de vos règles',
    chasing_entries: 'la poursuite des entrées',
    weak_setup_bias: 'un penchant pour les setups faibles',
  },
};

/**
 * Weekly behavioral review push (spec 13.3). Calm, non-judgemental. When a
 * top-priority pattern is known the body names it specifically; otherwise it
 * falls back to the spec's generic "a new behavioral pattern was detected".
 */
export function buildBehavioralReportContent(
  topPriority: BehavioralPatternKey | null | undefined,
  rawLocale: string | undefined,
  data: Record<string, string>,
): NotificationContent {
  const locale = resolveLocale(rawLocale);
  const label =
    topPriority && PATTERN_LABEL[locale][topPriority]
      ? PATTERN_LABEL[locale][topPriority]
      : null;

  const copy = {
    en: {
      title: 'Your weekly trading review is ready',
      labelled: label
        ? `We noticed a pattern around ${label}. A few minutes of reflection now can change next week.`
        : '',
      generic:
        'A new behavioral pattern was detected. A few minutes of reflection now can change next week.',
    },
    fr: {
      title: 'Votre bilan hebdomadaire de trading est prêt',
      labelled: label
        ? `Nous avons remarqué un schéma autour de ${label}. Quelques minutes de réflexion peuvent changer la semaine prochaine.`
        : '',
      generic:
        'Un nouveau schéma comportemental a été détecté. Quelques minutes de réflexion peuvent changer la semaine prochaine.',
    },
  }[locale];

  return {
    category: NotificationCategory.BehavioralReport,
    urgency: 'gentle',
    title: copy.title,
    body: label ? copy.labelled : copy.generic,
    data,
  };
}
