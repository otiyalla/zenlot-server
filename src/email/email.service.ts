import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ConfigService } from '@nestjs/config';
import {
  EMAIL_TRANSPORT,
  EmailTransport,
  EmailMessage,
} from './interfaces/email-transport.interface';

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
      throw new Error('Support email is not provided')
    }
    return supportEmail
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
            📩 New ${type} Submission
          </h3>
        </div>

        <!-- Body -->
        <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

          <p style="font-size:16px; margin:0;">
            <strong>From:</strong> <a href="mailto:${senderEmail}" style="color:#1A73E8; text-decoration:none;">${senderEmail}</a>
          </p>

          <p style="font-size:16px; margin-top:8px;">
            <strong>Type:</strong> ${type}
          </p>

          <p style="font-size:16px; margin-top:8px;">
            <strong>Subject:</strong> ${subject || '—'}
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:20px 0;" />

          <p style="font-size:16px; font-weight:bold; margin-bottom:8px;">
            Message:
          </p>

          <div style="font-size:15px; line-height:1.6; color:#444444;">
            ${message.replace(/\n/g, '<br/>')}
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
    gracePeriodDays: number = 30,
    timeZone = 'UTC'
  ): Promise<boolean> {

    try {
      const supportEmail = this.getSupportEmail();
      const now = new Date();
      const deletionDate = new Date(
        now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000,
      );
      const deletionDateDisplay = deletionDate.toLocaleString('en-US', {
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
        'SUMMARY:Zenlot account deletion',
        `DESCRIPTION:Your Zenlot account is scheduled for deletion on ${deletionDateDisplay}. Sign in before then to cancel.`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const emailBody = `
      <!-- Header -->
        <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
          <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
            🗑️ Account Deletion Scheduled
          </h2>
        </div>

        <!-- Body -->
        <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

          <p style="font-size:16px; margin:0;">
            Hi <strong>${userName}</strong>,
          </p>

          <p style="font-size:16px; margin-top:12px;">
            Your Zenlot account is scheduled for deletion. This is a final step and will take place in:
          </p>

          <p style="font-size:18px; font-weight:bold; color:#D32F2F; margin:12px 0;">
            ${gracePeriodDays} days — <strong>${deletionDateDisplay}</strong>
          </p>

          <p style="font-size:16px;">
            During this <strong>grace period</strong>, you still have options:
          </p>

          <ul style="font-size:16px; color:#444444; margin-top:8px;">
            <li>Sign in to your account to <strong>restore it</strong></li>
            <li>Export your trading data</li>
            <li>Contact our support team for help</li>
          </ul>

          <p style="font-size:16px; margin-top:12px;">
            After <strong>${gracePeriodDays} days</strong>, your account and all associated data will be <strong>permanently deleted</strong> and cannot be recovered.
          </p>

          <p style="font-size:16px;">
            We’ve also attached a calendar event for the scheduled deletion date to help you keep track.
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

          <p style="font-size:14px; color:#888888;">
            If you did <strong>not</strong> request this deletion, you can cancel it by signing in to your account immediately.
          </p>

        </div>

        <!-- Footer -->
        <div style="margin-top:24px; text-align:center; font-family:Arial, sans-serif; font-size:14px; color:#888888;">
          <p style="margin:0;">Zenlot Support Team</p>
        </div>
      `;

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: 'Action Required: Account Deletion Notice',
        replyTo: supportEmail,
        html: emailBody,
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
    timeZone = 'UTC',
  ): Promise<boolean> {
    try {
      const supportEmail = this.getSupportEmail();
      const cancelledAtDisplay = new Date().toLocaleString('en-US', {
        timeZone,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      const emailBody = `
      <!-- Header -->
        <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
          <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
            ✅ Account Deletion Cancelled
          </h2>
        </div>

        <!-- Body -->
        <div style="background-color:#ffffff; padding:24px; border-radius:8px; font-family:Arial, sans-serif; color:#444444; margin-top:16px;">

          <p style="font-size:16px; margin:0;">
            Hi <strong>${userName}</strong>,
          </p>

          <p style="font-size:16px; margin-top:12px;">
            Your Zenlot account deletion has been <strong>cancelled</strong>. Your account and data are safe.
          </p>

          <p style="font-size:16px; margin-top:12px;">
            Cancellation time: <strong>${cancelledAtDisplay}</strong>
          </p>

          <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

          <p style="font-size:14px; color:#888888;">
            If you did <strong>not</strong> request this change, please contact our support team at
            <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
          </p>
        </div>

        <!-- Footer -->
        <div style="margin-top:24px; text-align:center; font-family:Arial, sans-serif; font-size:14px; color:#888888;">
          <p style="margin:0;">Zenlot Support Team</p>
        </div>
      `;

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: 'Account Deletion Cancelled — Zenlot',
        replyTo: supportEmail,
        html: emailBody,
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
  ): Promise<boolean> {

    const supportEmail = this.getSupportEmail();
    try {
      const emailBody = `
      <!-- Hero Animation (Replace URL with your hosted animation or GIF) -->
        <div style="text-align:center; margin-bottom:24px;">
          <img
            src="https://yourcdn.com/zenlot-progress-animation.gif"
            alt="Track Your Growth Over Time"
            style="width:100%; max-width:600px; height:auto;"
          />
        </div>

        <h1 style="color:#2A2A2A; font-family:Arial, sans-serif; text-align:center;">
          👋 Welcome to Zenlot, ${fname}!
        </h1>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          We’re thrilled you’re here. Thanks for joining Zenlot — your partner for capturing trades, organizing notes, and tracking performance over time.
        </p>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          Below is your first milestone on the path to clearer, more confident trading:
        </p>

        <ul style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          <li><strong>Log your trades</strong> with outcomes, strategy tags, and emotion notes</li>
          <li><strong>Track performance</strong> to spot trends and evolve your edge</li>
          <li><strong>Centralize notes</strong> so your strategy improves with each session</li>
        </ul>

        <p style="font-family:Arial, sans-serif; font-size:16px; color:#4A4A4A;">
          Need help or want to share feedback? Just reply to this email or reach out at
          <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
        </p>

        <hr style="border:none; border-top:1px solid #E0E0E0; margin:24px 0;" />

        <p style="font-family:Arial, sans-serif; font-size:14px; color:#888888; text-align:center;">
          We’re glad you’re here — let’s grow your trading edge together. 🚀
        </p>
      `;

      const emailOptions: EmailMessage = {
        from: this.getFromEmail(),
        to: email,
        subject: `You’re In! Here’s What You Can Do Next with Zenlot ${fname}`,
        replyTo: supportEmail,
        html: emailBody,
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

  async sendPasswordResentEmail(
    email: string,
    password: string,
    fname: string,
  ): Promise<boolean> {
    const supportEmail = this.getSupportEmail();
    try {
      const emailBody = `
      <!-- Header -->
          <div style="background-color:#f7f9fc; padding:20px; text-align:center; border-radius:8px;">
            <h2 style="font-family:Arial, sans-serif; color:#333333; margin:0;">
              🔐 Password Reset
            </h2>
          </div>

          <!-- Body -->
          <div style="font-family:Arial, sans-serif; color:#444444; padding:24px; background-color:#ffffff; border-radius:8px; margin-top:16px;">
            <p style="font-size:16px; margin:0;">
              Hello <strong>${fname}</strong>,
            </p>

            <p style="font-size:16px; margin-top:12px;">
              Your password has been <strong>successfully reset</strong>. Please use the temporary password below to sign in:
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
              For your security, we strongly recommend you change this password as soon as you sign in.
            </p>

            <hr style="border:none; border-top:1px solid #e0e0e0; margin:24px 0;" />

            <p style="font-size:14px; color:#888888;">
              If you did <strong>not</strong> request this password reset, please contact our support team immediately at
              <a href="mailto:${supportEmail}" style="color:#1A73E8;">${supportEmail}</a>.
            </p>
          </div>

          <!-- Footer -->
          <div style="text-align:center; margin-top:24px; font-family:Arial, sans-serif; font-size:14px; color:#888888;">
            <p style="margin:0;">Thank you for choosing Zenlot.</p>
          </div>
        `;

      const emailOptions = {
        from: this.getFromEmail(),
        to: email,
        subject: 'Password Reset Confirmation — Zenlot',
        html: emailBody,
      };
      await this.transport.send(emailOptions);

      this.logger.log(`Password reset email sent to ${email}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send password reset email', error);
      Sentry.captureException(error, {
        extra: { email, context: 'sendPasswordResentEmail' },
      });
      return false;
    }
  }
}
