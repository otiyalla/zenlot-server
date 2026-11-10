import { resolveSupportedEmailLanguage } from './language.util';

type BuildPasswordResetTemplateParams = {
  fname: string;
  resetUrl: string;
  expiresInMinutes: number;
  language: string;
  supportEmail: string;
};

type PasswordResetTemplate = {
  subject: string;
  html: string;
};

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);

/**
 * Emails a single-use link that opens the app's "set a new password" screen.
 * Nothing about the account changes until the link is used, so the copy tells
 * the recipient they can safely ignore an email they didn't ask for.
 */
export const buildPasswordResetTemplate = ({
  fname,
  resetUrl,
  expiresInMinutes,
  language,
  supportEmail,
}: BuildPasswordResetTemplateParams): PasswordResetTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);

  const copyByLanguage = {
    en: {
      subject: 'Reset your Zenlot password',
      headline: '🔐 Reset your password',
      greeting: 'Hello',
      resetMessage:
        'We received a request to reset the password for your Zenlot account. Open the link below on the device where Zenlot is installed to choose a new password:',
      button: 'Set a new password',
      expiry: `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
      fallback: "If the button doesn't work, copy this link into your browser:",
      warning:
        "If you didn't request this, you can ignore this email: your password stays the same. If you keep receiving these emails, contact us at",
      footer: 'Thank you for choosing Zenlot.',
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe Zenlot',
      headline: '🔐 Réinitialisez votre mot de passe',
      greeting: 'Bonjour',
      resetMessage:
        'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Zenlot. Ouvrez le lien ci-dessous sur l’appareil où Zenlot est installé pour choisir un nouveau mot de passe :',
      button: 'Choisir un nouveau mot de passe',
      expiry: `Ce lien expire dans ${expiresInMinutes} minutes et ne peut être utilisé qu’une seule fois.`,
      fallback:
        'Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :',
      warning:
        'Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé. Si vous continuez à recevoir ces e-mails, contactez-nous à',
      footer: 'Merci d’utiliser Zenlot.',
    },
    es: {
      subject: 'Restablece tu contraseña de Zenlot',
      headline: '🔐 Restablece tu contraseña',
      greeting: 'Hola',
      resetMessage:
        'Recibimos una solicitud para restablecer la contraseña de tu cuenta de Zenlot. Abre el siguiente enlace en el dispositivo donde tienes instalado Zenlot para elegir una nueva contraseña:',
      button: 'Elegir una nueva contraseña',
      expiry: `Este enlace caduca en ${expiresInMinutes} minutos y solo se puede usar una vez.`,
      fallback: 'Si el botón no funciona, copia este enlace en tu navegador:',
      warning:
        'Si no solicitaste esto, puedes ignorar este correo: tu contraseña no cambia. Si sigues recibiendo estos correos, contáctanos en',
      footer: 'Gracias por elegir Zenlot.',
    },
  };

  const copy = copyByLanguage[supportedLanguage];
  const safeName = escapeHtml(fname);
  const safeUrl = escapeHtml(resetUrl);
  const safeSupport = escapeHtml(supportEmail);

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
              ${copy.greeting} <strong>${safeName}</strong>,
            </p>

            <p style="font-size:16px; margin-top:12px;">
              ${copy.resetMessage}
            </p>

            <div style="margin:24px 0; text-align:center;">
              <a href="${safeUrl}" style="
                display:inline-block;
                background-color:#1A73E8;
                color:#ffffff;
                padding:12px 24px;
                font-size:16px;
                font-weight:bold;
                border-radius:6px;
                text-decoration:none;
              ">${copy.button}</a>
            </div>

            <p style="font-size:14px; margin-top:12px;">
              ${copy.expiry}
            </p>

            <p style="font-size:13px; color:#666666; margin-top:12px; word-break:break-all;">
              ${copy.fallback}<br />
              <a href="${safeUrl}" style="color:#1A73E8;">${safeUrl}</a>
            </p>

            <hr style="border:none; border-top:1px solid #e0e0e0; margin:24px 0;" />

            <p style="font-size:14px; color:#888888;">
              ${copy.warning}
              <a href="mailto:${safeSupport}" style="color:#1A73E8;">${safeSupport}</a>.
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
