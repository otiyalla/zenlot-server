import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import * as Mixpanel from 'mixpanel';

export type AnalyticsUser = {
  id: string;
  email?: string | null;
  fname?: string | null;
  lname?: string | null;
  role?: string | null;
  language?: string | null;
  accountCurrency?: string | null;
  theme?: string | null;
  timezone?: string | null;
  createdAt?: Date | string | null;
};

type MixpanelClient = ReturnType<typeof Mixpanel.init>;

type TrackProps = Record<string, unknown>;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly env: string;
  private readonly client: MixpanelClient | null;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('MIXPANEL_TOKEN');
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
    this.env = nodeEnv || 'production';

    if (!token) {
      this.logger.warn(
        'Mixpanel token not configured. Analytics tracking is disabled.',
      );
      this.client = null;
      return;
    }

    this.client = Mixpanel.init(token, {
      debug: this.env === 'development' || this.env === 'local',
    });
  }

  trackEvent(eventName: string, distinctId: string, props?: TrackProps) {
    if (!this.client || !distinctId) return;

    const payload = {
      distinct_id: distinctId,
      ...this.baseProps(),
      ...this.cleanProps(props),
    };

    try {
      this.client.track(eventName, payload, (error) => {
        if (error) {
          this.logger.warn(`Mixpanel track failed: ${eventName}`, error);
        }
      });
    } catch (error) {
      this.logger.warn(`Mixpanel track failed: ${eventName}`, error);
      Sentry.captureException(error, { extra: { eventName } });
    }
  }

  identifyUser(user: AnalyticsUser) {
    if (!this.client || !user?.id) return;

    const accountAgeDays = this.getAccountAgeDays(user.createdAt);
    const userProps: TrackProps = {
      email: user.email,
      role: user.role,
      language: user.language,
      theme: user.theme,
      account_currency: user.accountCurrency,
      timezone: user.timezone,
      created_at: user.createdAt,
      account_age_days: accountAgeDays,
      env: this.env,
      ip: '0',
    };

    try {
      this.client.people.set(user.id, this.cleanProps(userProps), (error) => {
        if (error) {
          this.logger.warn('Mixpanel people.set failed', error);
        }
      });
    } catch (error) {
      this.logger.warn('Mixpanel people.set failed', error);
      Sentry.captureException(error, { extra: { userId: user.id } });
    }
  }

  trackAccountCreated(userId: string, signupMethod: string = 'email') {
    this.trackEvent('account_created', userId, { signup_method: signupMethod });
  }

  trackUserSignedIn(userId: string, signinMethod: string = 'email') {
    this.trackEvent('user_signed_in', userId, { signin_method: signinMethod });
  }

  trackUserSignedOut(userId: string) {
    this.trackEvent('user_signed_out', userId);
  }

  trackSessionVerified(userId: string, usedRefreshToken: boolean) {
    this.trackEvent('session_verified', userId, {
      used_refresh_token: usedRefreshToken,
    });
  }

  trackTokensRefreshed(userId: string, trigger: 'verify' | 'refresh') {
    this.trackEvent('tokens_refreshed', userId, { trigger });
  }

  trackAuthFailed(
    distinctId: string,
    flow: 'signin' | 'verify' | 'refresh' | 'signout',
    reason: string,
  ) {
    this.trackEvent('auth_failed', distinctId, { flow, reason });
  }

  trackPasswordResetRequested(userId: string) {
    this.trackEvent('password_reset_requested', userId);
  }

  trackPasswordChanged(userId: string) {
    this.trackEvent('password_changed', userId);
  }

  trackPasswordReset(userId: string) {
    this.trackEvent('password_reset', userId);
  }

  trackEmailVerified(userId: string) {
    this.trackEvent('email_verified', userId);
  }

  trackEmailVerificationRequested(userId: string) {
    this.trackEvent('email_verification_requested', userId);
  }

  trackUserUpdated(userId: string, updatedFields: string[]) {
    if (!updatedFields.length) return;
    this.trackEvent('user_updated', userId, { updated_fields: updatedFields });
  }

  trackAccountDeletionInitiated(
    userId: string,
    gracePeriodDays: number,
    deleteScheduledFor: Date,
  ) {
    this.trackEvent('account_deletion_initiated', userId, {
      grace_period_days: gracePeriodDays,
      delete_scheduled_for: deleteScheduledFor.toISOString(),
    });
  }

  trackAccountDeletionCancelled(userId: string) {
    this.trackEvent('account_deletion_cancelled', userId);
  }

  trackAccountDeleted(userId: string) {
    this.trackEvent('account_deleted', userId);
  }

  trackFeedbackSubmitted(
    distinctId: string,
    feedbackId: string,
    feedbackType?: string,
    userId?: string,
  ) {
    this.trackEvent('feedback_submitted', distinctId, {
      feedback_id: feedbackId,
      feedback_type: feedbackType,
      user_id: userId,
    });
  }

  trackFeedbackEmailSent(
    distinctId: string,
    feedbackId: string,
    feedbackType?: string,
    userId?: string,
  ) {
    this.trackEvent('feedback_email_sent', distinctId, {
      feedback_id: feedbackId,
      feedback_type: feedbackType,
      user_id: userId,
    });
  }

  private baseProps(): TrackProps {
    return {
      env: this.env,
      source: 'server',
    };
  }

  private getAccountAgeDays(
    createdAt?: Date | string | null,
  ): number | undefined {
    if (!createdAt) return undefined;
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created)) return undefined;
    const diffMs = Date.now() - created;
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  private cleanProps(props?: TrackProps): TrackProps {
    if (!props) return {};

    return Object.fromEntries(
      Object.entries(props).filter(
        ([, value]) => value !== undefined && value !== null,
      ),
    );
  }
}
