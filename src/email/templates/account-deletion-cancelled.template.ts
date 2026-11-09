import {
  getLocaleForLanguage,
  resolveSupportedEmailLanguage,
} from './language.util';

type BuildAccountDeletionCancelledTemplateParams = {
  userName: string;
  language: string;
  timeZone: string;
  supportEmail: string;
  now?: Date;
};

type AccountDeletionCancelledTemplate = {
  subject: string;
  html: string;
  replyTo: string;
};

export const buildAccountDeletionCancelledTemplate = ({
  userName,
  language,
  timeZone,
  supportEmail,
  now = new Date(),
}: BuildAccountDeletionCancelledTemplateParams): AccountDeletionCancelledTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);
  const locale = getLocaleForLanguage(supportedLanguage);

  const copyByLanguage = {
    en: {
      subject: 'Account Deletion Cancelled - Zenlot',
      headline: '✅ Account Deletion Cancelled',
      greeting: 'Hi',
      cancelledMessage:
        'Your Zenlot account deletion has been <strong>cancelled</strong>. Your account and data are safe.',
      cancellationLabel: 'Cancellation time',
      securityMessage:
        'If you did <strong>not</strong> request this change, please contact our support team at',
      footerTeam: 'Zenlot Support Team',
    },
    fr: {
      subject: 'Suppression du compte annulee - Zenlot',
      headline: '✅ Suppression du compte annulee',
      greeting: 'Bonjour',
      cancelledMessage:
        'La suppression de votre compte Zenlot a ete <strong>annulee</strong>. Votre compte et vos donnees sont en securite.',
      cancellationLabel: "Heure d'annulation",
      securityMessage:
        "Si vous n'avez <strong>pas</strong> demande ce changement, veuillez contacter notre equipe support a",
      footerTeam: 'Equipe support Zenlot',
    },
    es: {
      subject: 'Eliminación de cuenta cancelada - Zenlot',
      headline: '✅ Eliminación de cuenta cancelada',
      greeting: 'Hola',
      cancelledMessage:
        'La eliminación de tu cuenta de Zenlot ha sido <strong>cancelada</strong>. Tu cuenta y tus datos están a salvo.',
      cancellationLabel: 'Hora de cancelación',
      securityMessage:
        'Si <strong>no</strong> solicitaste este cambio, contacta a nuestro equipo de soporte en',
      footerTeam: 'Equipo de soporte de Zenlot',
    },
  };

  const copy = copyByLanguage[supportedLanguage];

  const cancelledAtDisplay = now.toLocaleString(locale, {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const html = `
      <!-- Header -->
        <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
          <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
            ${copy.headline}
          </h2>
        </div>

        <!-- Body -->
        <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

          <p style="font-size:16px; margin:0;">
            ${copy.greeting} <strong>${userName}</strong>,
          </p>

          <p style="font-size:16px; margin-top:12px;">
            ${copy.cancelledMessage}
          </p>

          <p style="font-size:16px; margin-top:12px;">
            ${copy.cancellationLabel}: <strong>${cancelledAtDisplay}</strong>
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

          <p style="font-size:14px; color:#888888;">
            ${copy.securityMessage}
            <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="margin-top:24px; text-align:center; font-family:Arial, sans-serif; font-size:14px; color:#888888;">
          <p style="margin:0;">${copy.footerTeam}</p>
        </div>
      `;

  return {
    subject: copy.subject,
    html,
    replyTo: supportEmail,
  };
};
