import { resolveSupportedEmailLanguage } from './language.util';

type BuildWelcomeTemplateParams = {
  fname: string;
  language: string;
  supportEmail: string;
  /** Destination for the primary call-to-action button (the app entry point). */
  ctaUrl: string;
};

type WelcomeTemplate = {
  subject: string;
  html: string;
  replyTo: string;
};

export const buildWelcomeTemplate = ({
  fname,
  language,
  supportEmail,
  ctaUrl,
}: BuildWelcomeTemplateParams): WelcomeTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);

  const copyByLanguage = {
    en: {
      subject: `Welcome to Zenlot, ${fname} — let's build your trading discipline`,
      heroAnimationUrl:
        'https://pub-61217234bef24505baffb476955a8686.r2.dev/zenlot_welcome_hero.gif',
      heroAlt: 'Trade with discipline, not emotion',
      heading: `👋 Welcome to Zenlot, ${fname}!`,
      intro:
        "Zenlot isn't a signal service or just another trade journal. It's your trading-discipline and risk-management OS — it grades how well you follow your own process, not your P&L. A trade that follows your rules and loses beats one that breaks them and wins.",
      milestoneIntro: 'Here is what Zenlot does for you from day one:',
      bulletOne:
        '<strong>Risk engine</strong> — position sizing, exposure limits, and drawdown circuit-breakers that warn you before you over-risk. Advisory only — you always stay in control.',
      bulletTwo:
        '<strong>Pre-trade evaluation</strong> — score your setup quality and check it against your own trading plan before you enter.',
      bulletThree:
        '<strong>Process-vs-outcome verdicts</strong> — see when a win was actually luck, so you never reinforce a habit that will cost you later.',
      bulletFour:
        '<strong>Behavioral intelligence</strong> — once you have logged a few trades, Zenlot surfaces the patterns holding you back, with plain-language coaching.',
      ctaIntro:
        'Start by setting your risk limits and defining your trading plan:',
      ctaLabel: 'Open Zenlot',
      supportMessage:
        'Questions or feedback? Just reply to this email or reach us at',
      footer:
        "Process over outcome — let's build the discipline that compounds.",
    },
    fr: {
      subject: `Bienvenue sur Zenlot, ${fname} — bâtissons votre discipline de trading`,
      heroAnimationUrl:
        'https://pub-61217234bef24505baffb476955a8686.r2.dev/zenlot_welcome_hero.gif',
      heroAlt: 'Tradez avec discipline, pas avec émotion',
      heading: `👋 Bienvenue sur Zenlot, ${fname}!`,
      intro:
        "Zenlot n'est ni un service de signaux ni un simple journal de trading. C'est votre système de discipline et de gestion du risque — il évalue la manière dont vous suivez votre propre processus, pas votre P&L. Un trade qui respecte vos règles et perd vaut mieux qu'un trade qui les enfreint et gagne.",
      milestoneIntro:
        'Voici ce que Zenlot fait pour vous dès le premier jour :',
      bulletOne:
        "<strong>Moteur de risque</strong> — calcul de la taille de position, limites d'exposition et coupe-circuits de drawdown qui vous alertent avant de trop risquer. À titre indicatif — vous gardez toujours le contrôle.",
      bulletTwo:
        "<strong>Évaluation avant trade</strong> — notez la qualité de votre setup et confrontez-le à votre propre plan de trading avant d'entrer.",
      bulletThree:
        "<strong>Verdict processus vs résultat</strong> — repérez quand un gain n'était que de la chance, pour ne jamais renforcer une habitude qui vous coûtera plus tard.",
      bulletFour:
        '<strong>Intelligence comportementale</strong> — après quelques trades enregistrés, Zenlot révèle les schémas qui vous freinent, avec un coaching en langage clair.',
      ctaIntro:
        'Commencez par définir vos limites de risque et votre plan de trading :',
      ctaLabel: 'Ouvrir Zenlot',
      supportMessage:
        'Une question ou un retour ? Répondez simplement à cet email ou écrivez-nous à',
      footer:
        'Le processus avant le résultat — bâtissons la discipline qui se cumule.',
    },
  };

  const copy = copyByLanguage[supportedLanguage];

  const html = `
      <!-- Hero Animation (Replace URL with your hosted animation or GIF) -->
        <div style="text-align:center; margin-bottom:24px;">
          <img
            src="${copy.heroAnimationUrl}"
            alt="${copy.heroAlt}"
            style="width:100%; max-width:600px; height:auto;"
          />
        </div>

        <h1 style="color:#2A2A2A; font-family:Arial, sans-serif; text-align:center;">
          ${copy.heading}
        </h1>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          ${copy.intro}
        </p>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          ${copy.milestoneIntro}
        </p>

        <ul style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          <li style="margin-bottom:8px;">${copy.bulletOne}</li>
          <li style="margin-bottom:8px;">${copy.bulletTwo}</li>
          <li style="margin-bottom:8px;">${copy.bulletThree}</li>
          <li style="margin-bottom:8px;">${copy.bulletFour}</li>
        </ul>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          ${copy.ctaIntro}
        </p>

        <!-- Primary call-to-action -->
        <div style="text-align:center; margin:28px 0;">
          <a
            href="${ctaUrl}"
            style="display:inline-block; background-color:#1A73E8; color:#ffffff; text-decoration:none; font-family:Arial, sans-serif; font-size:16px; font-weight:bold; padding:14px 32px; border-radius:8px;"
          >
            ${copy.ctaLabel}
          </a>
        </div>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          ${copy.supportMessage}
          <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
        </p>

        <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

        <p style="font-family:Arial, sans-serif; font-size:14px; color:#888888; text-align:center;">
          ${copy.footer}
        </p>
      `;

  return {
    subject: copy.subject,
    html,
    replyTo: supportEmail,
  };
};
