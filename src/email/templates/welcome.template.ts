import { resolveSupportedEmailLanguage } from './language.util';

type BuildWelcomeTemplateParams = {
  fname: string;
  language: string;
  supportEmail: string;
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
}: BuildWelcomeTemplateParams): WelcomeTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);

  const copyByLanguage = {
    en: {
      subject: `You're in! Here's what you can do next with Zenlot ${fname}`,
      heroAnimationUrl:
        'https://pub-61217234bef24505baffb476955a8686.r2.dev/zenlot_welcome_hero.gif',
      heroAlt: 'Track your growth over time',
      heading: `👋 Welcome to Zenlot, ${fname}!`,
      intro:
        "We're thrilled you're here. Thanks for joining Zenlot - your partner for capturing trades, organizing notes, and tracking performance over time.",
      milestoneIntro:
        'Below is your first milestone on the path to clearer, more confident trading:',
      bulletOne:
        '<strong>Log your trades</strong> with outcomes, strategy tags, and emotion notes',
      bulletTwo:
        '<strong>Track performance</strong> to spot trends and evolve your edge',
      bulletThree:
        '<strong>Centralize notes</strong> so your strategy improves with each session',
      supportMessage:
        'Need help or want to share feedback? Just reply to this email or reach out at',
      footer: "We're glad you're here - let's grow your trading edge together.",
    },
    fr: {
      subject: `Bienvenue sur Zenlot : prochaines etapes pour ${fname}`,
      heroAnimationUrl:
        'https://pub-61217234bef24505baffb476955a8686.r2.dev/zenlot_welcome_hero.gif',
      heroAlt: 'Suivez votre progression au fil du temps',
      heading: `👋 Bienvenue sur Zenlot, ${fname}!`,
      intro:
        "Nous sommes ravis de vous accueillir. Merci d'avoir rejoint Zenlot - votre partenaire pour enregistrer vos trades, organiser vos notes et suivre vos performances dans le temps.",
      milestoneIntro:
        'Voici votre premier jalon vers un trading plus clair et plus confiant :',
      bulletOne:
        '<strong>Enregistrez vos trades</strong> avec les resultats, tags de strategie et notes emotionnelles',
      bulletTwo:
        '<strong>Suivez vos performances</strong> pour identifier les tendances et affiner votre avantage',
      bulletThree:
        '<strong>Centralisez vos notes</strong> pour ameliorer votre strategie a chaque session',
      supportMessage:
        'Besoin daide ou envie de partager un retour ? Repondez a cet email ou contactez-nous a',
      footer:
        'Nous sommes heureux de vous compter parmi nous - faisons progresser votre avantage de trading ensemble.',
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
          <li>${copy.bulletOne}</li>
          <li>${copy.bulletTwo}</li>
          <li>${copy.bulletThree}</li>
        </ul>

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
