import { resolveSupportedEmailLanguage } from './language.util';

type BuildPasswordResetTemplateParams = {
  fname: string;
  password: string;
  language: string;
  supportEmail: string;
};

type PasswordResetTemplate = {
  subject: string;
  html: string;
};

export const buildPasswordResetTemplate = ({
  fname,
  password,
  language,
  supportEmail,
}: BuildPasswordResetTemplateParams): PasswordResetTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);

  const copyByLanguage = {
    en: {
      subject: 'Password Reset Confirmation - Zenlot',
      headline: '🔐 Password Reset',
      greeting: 'Hello',
      resetMessage:
        'Your password has been <strong>successfully reset</strong>. Please use the temporary password below to sign in:',
      recommendation:
        'For your security, we strongly recommend you change this password as soon as you sign in.',
      warning:
        'If you did <strong>not</strong> request this password reset, please contact our support team immediately at',
      footer: 'Thank you for choosing Zenlot.',
    },
    fr: {
      subject: 'Confirmation de reinitialisation du mot de passe - Zenlot',
      headline: '🔐 Reinitialisation du mot de passe',
      greeting: 'Bonjour',
      resetMessage:
        'Votre mot de passe a ete <strong>reinitialise avec succes</strong>. Veuillez utiliser le mot de passe temporaire ci-dessous pour vous connecter :',
      recommendation:
        'Pour votre securite, nous vous recommandons fortement de changer ce mot de passe des votre connexion.',
      warning:
        "Si vous n'avez <strong>pas</strong> demande cette reinitialisation de mot de passe, veuillez contacter immediatement notre equipe support a",
      footer: "Merci d'utiliser Zenlot.",
    },
    es: {
      subject: 'Confirmación de restablecimiento de contraseña - Zenlot',
      headline: '🔐 Restablecimiento de contraseña',
      greeting: 'Hola',
      resetMessage:
        'Tu contraseña se ha <strong>restablecido correctamente</strong>. Usa la contraseña temporal a continuación para iniciar sesión:',
      recommendation:
        'Por tu seguridad, te recomendamos encarecidamente cambiar esta contraseña en cuanto inicies sesión.',
      warning:
        'Si <strong>no</strong> solicitaste este restablecimiento de contraseña, contacta a nuestro equipo de soporte de inmediato en',
      footer: 'Gracias por elegir Zenlot.',
    },
  };

  const copy = copyByLanguage[supportedLanguage];

  const html = `
      <!-- Header -->
          <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
            <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
              ${copy.headline}
            </h2>
          </div>

          <!-- Body -->
          <div style="font-family:Arial, sans-serif; color:#444444; padding:24px; background-color:#ffffff; border-radius:8px; margin-top:16px;">
            <p style="font-size:16px; margin:0;">
              ${copy.greeting} <strong>${fname}</strong>,
            </p>

            <p style="font-size:16px; margin-top:12px;">
              ${copy.resetMessage}
            </p>

            <div style="margin:16px 0; text-align:center;">
              <span style="
                display:inline-block;
                background-color:#eef3fa;
                color:#2a2a2a;
                padding:12px 20px;
                font-size:18px;
                font-weight:bold;
                border-radius:6px;
                letter-spacing:1px;
              ">
                ${password}
              </span>
            </div>

            <p style="font-size:16px; margin-top:12px;">
              ${copy.recommendation}
            </p>

            <hr style="border:none; border-top:1px solid #e0e0e0; margin:24px 0;" />

            <p style="font-size:14px; color:#888888;">
              ${copy.warning}
              <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
            </p>
          </div>

          <!-- Footer -->
          <div style="text-align:center; margin-top:24px; font-family:Arial, sans-serif; font-size:14px; color:#888888;">
            <p style="margin:0;">${copy.footer}</p>
          </div>
        `;

  return {
    subject: copy.subject,
    html,
  };
};
