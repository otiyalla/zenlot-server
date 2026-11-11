import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_TRANSPORT,
  EmailTransport,
  EmailMessage,
} from './interfaces/email-transport.interface';
import {
  buildAccountDeletionCancelledTemplate,
  buildAccountDeletionNoticeTemplate,
  buildPasswordResetTemplate,
  buildWelcomeTemplate,
} from './templates';

// App route (expo-router) that redeems a password-reset token.
export const PASSWORD_RESET_APP_PATH = 'newpassword';

// Origin of the app's universal links (iOS associated domains / Android App
// Links). zenlot.net serves the apple-app-site-association and assetlinks.json
// files that let it open the app, and a fallback page when the app isn't
// installed. Override with APP_LINK_URL (e.g. `zenlot://` for a local build
// without the associated-domains entitlement).
export const DEFAULT_APP_LINK_URL = 'https://zenlot.net/';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_MAP[character]);
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
  ) {}

  private getFromEmail(): string {
    const from = this.configService.get<string>('EMAIL_FROM');
    if (!from) {
      throw new Error('EMAIL_FROM not configured');
    }
    return from;
  }

  private getSupportEmail(): string {
    const supportEmail =
      this.configService.get<string>('SUPPORT_EMAIL') || this.getFromEmail();
    if (!supportEmail) {
      throw new Error('Support email is not provided');
    }
    return supportEmail;
  }

  /**
   * App entry point for email call-to-action links. Defaults to the `zenlot://`
   * custom-scheme deep link, which opens the app at its root (the auth gate
   * routes a signed-in user straight to Home). Universal links only cover the
   * routes zenlot.net claims (see `getAppLinkUrl`), so the root stays on the
   * custom scheme. Override via APP_URL.
   */
  private getAppUrl(): string {
    return this.configService.get<string>('APP_URL') || 'zenlot://';
  }

  async sendFeedbackEmail(
    senderEmail: string,
    subject: string,
    message: string,
    type: string = 'feedback',
  ): Promise<boolean> {
    try {
      const feedbackRecipient = this.configService.get<string>(
        'FEEDBACK_EMAIL_RECIPIENT',
      );
      if (!feedbackRecipient) {
        this.logger.error('FEEDBACK_EMAIL_RECIPIENT not configured');
        return false;
      }

      const emailBody = `
      <!-- Header -->
        <div style="background-color:#f7f9fc; padding:15px 20px; text-align:center; border-radius:8px;">
          <h3 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
            📩 New ${escapeHtml(type)} Submission
          </h3>
        </div>

        <!-- Body -->
        <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

          <p style="font-size:16px; margin:0;">
            <strong>From:</strong> <a href="mailto:${escapeHtml(senderEmail)}" style="color:#1A73E8; text-decoration:none;">${escapeHtml(senderEmail)}</a>
          </p>

          <p style="font-size:16px; margin-top:8px;">
            <strong>Type:</strong> ${escapeHtml(type)}
          </p>

          <p style="font-size:16px; margin-top:8px;">
            <strong>Subject:</strong> ${escapeHtml(subject || '—')}
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:20px 0;" />

          <p style="font-size:16px; font-weight:bold; margin-bottom:8px;">
            Message:
          </p>

          <div style="font-size:15px; line-height:1.6; color:#444444;">
            ${escapeHtml(message).replace(/\n/g, '<br/>')}
          </div>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:20px 0;" />

          <p style="font-size:13px; color:#888888; text-align:right; margin:0;">
            Sent at ${new Date().toLocaleString()}
          </p>

        </div>
      `;

      const emailOptions = {
        from: this.getFromEmail(),
        to: feedbackRecipient,
        replyTo: senderEmail,
        subject: `[${type.toUpperCase()}] - ${subject}`,
        html: emailBody,
      };
      await this.transport.send(emailOptions);

      this.logger.log(`Feedback email sent to ${feedbackRecipient}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send feedback email', error);
      Sentry.captureException(error, {
        extra: { senderEmail, subject, context: 'sendFeedbackEmail' },
      });
      return false;
    }
  }

  //TODO: Verify implementation of send verification email to ensure it works as expected
  async sendVerificationEmail(
    email: string,
    verificationCode: string,
    userName: string,
  ): Promise<boolean> {
    try {
      const appUrl =
        this.configService.get<string>('APP_URL') || 'https://zenlot.app';
      const verificationLink = `${appUrl}/verify-email?code=${verificationCode}`;

      const emailBody = `
        <!-- Header -->
          <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
            <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
              📧 Verify Your Email
            </h2>
          </div>

          <!-- Body -->
          <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

            <p style="font-size:16px; margin:0;">
              Hi <strong>${userName}</strong>,
            </p>

            <p style="font-size:16px; margin-top:12px;">
              Welcome to Zenlot! To complete your registration, please verify your email address.
            </p>

            <p style="font-size:18px; font-weight:bold; text-align:center; margin:20px 0;">
              Your verification code:
            </p>

            <div style="text-align:center;">
              <span style="
                display:inline-block;
                background-color:#eef3fa;
                color:#2a2a2a;
                padding:14px 24px;
                font-size:20px;
                font-weight:bold;
                border-radius:6px;
                letter-spacing:2px;
              ">
                ${verificationCode}
              </span>
            </div>

            <p style="font-size:16px; text-align:center; margin:20px 0;">
              — OR —
            </p>

            <div style="text-align:center; margin-bottom:20px;">
              <a href="${verificationLink}" style="
                display:inline-block;
                background-color:#1A73E8;
                color:#ffffff;
                padding:12px 28px;
                border-radius:6px;
                font-size:16px;
                font-weight:bold;
                text-decoration:none;
              ">
                Verify My Email
              </a>
            </div>

            <p style="font-size:14px; color:#888888;">
              This code and link will expire in <strong>24 hours</strong>.
            </p>

            <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

            <p style="font-size:14px; color:#888888;">
              If you didn’t sign up for Zenlot, just ignore this email — no action is needed.
            </p>

          </div>
        `;

      const emailOptions = {
        from: this.getFromEmail(),
        to: email,
        subject: 'Verify Your Zenlot Email Address',
        html: emailBody,
      };
      await this.transport.send(emailOptions);

      this.logger.log(`Verification email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send verification email', error);
      Sentry.captureException(error, {
        extra: { email, context: 'sendVerificationEmail' },
      });
      return false;
    }
  }

  async sendAccountDeletionNotice(
    email: string,
    userName: string,
    language: string,
    gracePeriodDays: number = 30,
    timeZone = 'UTC',
  ): Promise<boolean> {
    try {
      const supportEmail = this.getSupportEmail();
      const template = buildAccountDeletionNoticeTemplate({
        email,
        userName,
        language,
        gracePeriodDays,
        timeZone,
        supportEmail,
      });

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: template.subject,
        replyTo: template.replyTo,
        html: template.html,
        attachments: template.attachments,
      };

      await this.transport.send(emailOptions);
      this.logger.log(`Deletion notice email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send deletion notice email', error);
      Sentry.captureException(error, {
        extra: { email, context: 'sendAccountDeletionNotice' },
      });
      return false;
    }
  }

  async sendAccountDeletionCancelledNotice(
    email: string,
    userName: string,
    language: string,
    timeZone = 'UTC',
  ): Promise<boolean> {
    try {
      const supportEmail = this.getSupportEmail();
      const template = buildAccountDeletionCancelledTemplate({
        userName,
        language,
        timeZone,
        supportEmail,
      });

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: template.subject,
        replyTo: template.replyTo,
        html: template.html,
      };

      await this.transport.send(emailOptions);
      this.logger.log(`Deletion cancellation email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send deletion cancellation email', error);
      Sentry.captureException(error, {
        extra: { email, context: 'sendAccountDeletionCancelledNotice' },
      });
      return false;
    }
  }

  async sendWelcomeEmail(
    email: string,
    fname: string,
    lname: string,
    language: string,
  ): Promise<boolean> {
    const supportEmail = this.getSupportEmail();
    try {
      const template = buildWelcomeTemplate({
        fname,
        language,
        supportEmail,
        ctaUrl: this.getAppUrl(),
      });

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: template.subject,
        replyTo: template.replyTo,
        html: template.html,
      };

      await this.transport.send(emailOptions);
      this.logger.log(`Welcome email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send welcome email', error);
      Sentry.captureException(error, {
        extra: { email, context: 'sendWelcomeEmail' },
      });
      return false;
    }
  }

  /**
   * Emails a single-use link to the app's "set a new password" screen
   * (`https://zenlot.net/newpassword?token=…`). The token is the only credential in the
   * link; nothing about the account changes until it is redeemed.
   */
  async sendPasswordResetLinkEmail(
    email: string,
    token: string,
    fname: string,
    language: string,
    expiresInMinutes: number,
  ): Promise<boolean> {
    try {
      const supportEmail = this.getSupportEmail();
      const template = buildPasswordResetTemplate({
        fname,
        resetUrl: this.buildAppLink(PASSWORD_RESET_APP_PATH, { token }),
        expiresInMinutes,
        language,
        supportEmail,
      });

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: template.subject,
        html: template.html,
      };
      await this.transport.send(emailOptions);

      this.logger.log('Password reset link email sent');
      return true;
    } catch (error) {
      this.logger.error('Failed to send password reset link email', error);
      Sentry.captureException(error, {
        extra: { context: 'sendPasswordResetLinkEmail' },
      });
      return false;
    }
  }

  /** Universal-link origin for app routes zenlot.net claims. */
  private getAppLinkUrl(): string {
    return (
      this.configService.get<string>('APP_LINK_URL') || DEFAULT_APP_LINK_URL
    );
  }

  /** `APP_LINK_URL` joined with an app route, e.g. `https://zenlot.net/newpassword?token=…`. */
  private buildAppLink(path: string, params: Record<string, string>): string {
    const base = this.getAppLinkUrl();
    const separator = base.endsWith('/') ? '' : '/';
    const query = new URLSearchParams(params).toString();
    return `${base}${separator}${path}?${query}`;
  }
}
