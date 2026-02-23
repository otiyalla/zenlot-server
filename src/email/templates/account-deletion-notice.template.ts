import { EmailAttachment } from '../interfaces/email-transport.interface';
import {
  getLocaleForLanguage,
  resolveSupportedEmailLanguage,
} from './language.util';

type BuildAccountDeletionNoticeTemplateParams = {
  email: string;
  userName: string;
  language: string;
  gracePeriodDays: number;
  timeZone: string;
  supportEmail: string;
  now?: Date;
};

type AccountDeletionNoticeTemplate = {
  subject: string;
  html: string;
  replyTo: string;
  attachments: EmailAttachment[];
};

export const buildAccountDeletionNoticeTemplate = ({
  email,
  userName,
  language,
  gracePeriodDays,
  timeZone,
  supportEmail,
  now = new Date(),
}: BuildAccountDeletionNoticeTemplateParams): AccountDeletionNoticeTemplate => {
  const supportedLanguage = resolveSupportedEmailLanguage(language);
  const locale = getLocaleForLanguage(supportedLanguage);

  const copyByLanguage = {
    en: {
      subject: 'Action Required: Account Deletion Notice',
      headline: '🗑️ Account Deletion Scheduled',
      greeting: 'Hi',
      scheduledMessage:
        'Your Zenlot account is scheduled for deletion. This is a final step and will take place in:',
      gracePeriodIntro:
        'During this <strong>grace period</strong>, you still have options:',
      restoreBullet: 'Sign in to your account to <strong>restore it</strong>',
      exportBullet: 'Export your trading data',
      supportBullet: 'Contact our support team for help',
      permanentDeletionMessage: (daysLabel: string) =>
        `After <strong>${daysLabel}</strong>, your account and all associated data will be <strong>permanently deleted</strong> and cannot be recovered.`,
      calendarMessage:
        'We have also attached a calendar event for the scheduled deletion date to help you keep track.',
      securityNotice:
        'If you did <strong>not</strong> request this deletion, you can cancel it by signing in to your account immediately.',
      footerTeam: 'Zenlot Support Team',
      icsSummary: 'Zenlot account deletion',
      icsDescription: (deletionDateDisplay: string) =>
        `Your Zenlot account is scheduled for deletion on ${deletionDateDisplay}. Sign in before then to cancel.`,
      gracePeriodLabel: (days: number) => `${days} day${days === 1 ? '' : 's'}`,
    },
    fr: {
      subject: 'Action requise : avis de suppression de compte',
      headline: '🗑️ Suppression du compte planifiee',
      greeting: 'Bonjour',
      scheduledMessage:
        "La suppression de votre compte Zenlot est planifiee. Il s'agit de l'etape finale et elle aura lieu dans :",
      gracePeriodIntro:
        'Pendant cette <strong>periode de grace</strong>, vous avez encore des options :',
      restoreBullet:
        'Connectez-vous a votre compte pour <strong>le restaurer</strong>',
      exportBullet: 'Exportez vos donnees de trading',
      supportBullet: "Contactez notre equipe support pour obtenir de l'aide",
      permanentDeletionMessage: (daysLabel: string) =>
        `Apres <strong>${daysLabel}</strong>, votre compte et toutes les donnees associees seront <strong>supprimes definitivement</strong> et ne pourront pas etre recuperees.`,
      calendarMessage:
        'Nous avons egalement joint un evenement calendrier pour la date de suppression planifiee afin de vous aider a la suivre.',
      securityNotice:
        "Si vous n'avez <strong>pas</strong> demande cette suppression, vous pouvez l'annuler en vous connectant immediatement a votre compte.",
      footerTeam: 'Equipe support Zenlot',
      icsSummary: 'Suppression du compte Zenlot',
      icsDescription: (deletionDateDisplay: string) =>
        `Votre compte Zenlot est planifie pour suppression le ${deletionDateDisplay}. Connectez-vous avant cette date pour annuler.`,
      gracePeriodLabel: (days: number) =>
        `${days} jour${days === 1 ? '' : 's'}`,
    },
  };

  const copy = copyByLanguage[supportedLanguage];

  const deletionDate = new Date(
    now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
  );
  const deletionDateDisplay = deletionDate.toLocaleString(locale, {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const formatIcsDate = (date: Date): string =>
    date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

  const uid = `zenlot-deletion-${Buffer.from(email).toString('hex')}`;
  const eventStart = deletionDate;
  const eventEnd = new Date(deletionDate.getTime() + 15 * 60 * 1000);
  const daysLabel = copy.gracePeriodLabel(gracePeriodDays);

  const icsBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Zenlot//Account Deletion//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(now)}`,
    `DTSTART:${formatIcsDate(eventStart)}`,
    `DTEND:${formatIcsDate(eventEnd)}`,
    `SUMMARY:${copy.icsSummary}`,
    `DESCRIPTION:${copy.icsDescription(deletionDateDisplay)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

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
            ${copy.scheduledMessage}
          </p>

          <p style="font-size:18px; font-weight:bold; color:#D32F2F; margin:12px 0;">
            ${daysLabel} - <strong>${deletionDateDisplay}</strong>
          </p>

          <p style="font-size:16px;">
            ${copy.gracePeriodIntro}
          </p>

          <ul style="font-size:16px; color:#444444; margin-top:8px;">
            <li>${copy.restoreBullet}</li>
            <li>${copy.exportBullet}</li>
            <li>${copy.supportBullet}</li>
          </ul>

          <p style="font-size:16px; margin-top:12px;">
            ${copy.permanentDeletionMessage(daysLabel)}
          </p>

          <p style="font-size:16px;">
            ${copy.calendarMessage}
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

          <p style="font-size:14px; color:#888888;">
            ${copy.securityNotice}
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
    attachments: [
      {
        filename: 'zenlot-account-deletion.ics',
        content: Buffer.from(icsBody).toString('base64'),
        contentType: 'text/calendar; charset=utf-8',
        disposition: 'attachment',
        encoding: 'base64',
      },
    ],
  };
};
