import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ExpoPushMessage } from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from './expo-push.service';
import { PushTokenService } from './push-token.service';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  NotificationCategory,
  NotificationContent,
} from './notification.types';
import {
  BehavioralPatternKey,
  buildBehavioralReportContent,
  buildCoachingReadyContent,
  buildDrawdownAlertContent,
  buildGovernanceAlertContent,
  buildJournalReminderContent,
  buildTradeClosedContent,
  DrawdownPeriod,
  TradeClosedCopyInput,
} from './notification.copy';

/** Channel id the client registers on Android; mirrored here for parity. */
const ANDROID_CHANNEL_ID = 'default';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly expoPush: ExpoPushService,
    private readonly pushTokens: PushTokenService,
    private readonly preferences: NotificationPreferenceService,
  ) {}

  // ---- Public trigger entry points -------------------------------------------
  // Each is best-effort: it must never throw into the caller (a trigger's main
  // job — closing a trade, generating coaching — must succeed regardless).

  async notifyTradeClosed(
    userId: string,
    input: TradeClosedCopyInput & { tradeId: string },
  ): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildTradeClosedContent(input, locale, {
        category: NotificationCategory.TradeClosed,
        tradeId: input.tradeId,
        route: '/(protected)/(tabs)/history',
      }),
    );
  }

  async notifyCoachingReady(
    userId: string,
    params: {
      tradeId: string;
      governanceLogId: string;
      symbol?: string;
      coaching?: string;
    },
  ): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildCoachingReadyContent(params.symbol, params.coaching, locale, {
        category: NotificationCategory.CoachingReady,
        tradeId: params.tradeId,
        governanceLogId: params.governanceLogId,
        route: '/(protected)/(profile)/governance',
      }),
    );
  }

  async notifyDrawdownBreach(
    userId: string,
    period: DrawdownPeriod,
  ): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildDrawdownAlertContent(period, locale, {
        category: NotificationCategory.DrawdownAlert,
        period,
        route: '/(protected)/(profile)/drawdown',
      }),
    );
  }

  async notifyGovernanceViolation(
    userId: string,
    params: { tradeId?: string; governanceLogId: string; symbol?: string },
  ): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildGovernanceAlertContent(params.symbol, locale, {
        category: NotificationCategory.GovernanceAlert,
        ...(params.tradeId ? { tradeId: params.tradeId } : {}),
        governanceLogId: params.governanceLogId,
        route: '/(protected)/(profile)/governance',
      }),
    );
  }

  async notifyJournalReminder(userId: string): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildJournalReminderContent(locale, {
        category: NotificationCategory.JournalReminder,
        route: '/(protected)/(tabs)/journal',
      }),
    );
  }

  /**
   * Weekly behavioral-review push (spec 13.3). Pattern-specific when a
   * top-priority pattern is known. Best-effort — never throws into the caller.
   */
  async notifyBehavioralReport(
    userId: string,
    params: { reportId: string; topPriority?: BehavioralPatternKey | null },
  ): Promise<void> {
    await this.dispatch(userId, (locale) =>
      buildBehavioralReportContent(params.topPriority ?? null, locale, {
        category: NotificationCategory.BehavioralReport,
        reportId: params.reportId,
        route: '/(protected)/(tabs)/journal',
      }),
    );
  }

  // ---- Core dispatch ---------------------------------------------------------

  /**
   * Resolves the user's locale/timezone/preferences, builds the content, checks
   * it is allowed (master switch, category toggle, quiet hours), sends it to all
   * the user's enabled devices, then reconciles token health (mark used / disable
   * undeliverable). Swallows all errors — push is never load-bearing.
   */
  private async dispatch(
    userId: string,
    build: (locale: string) => NotificationContent,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { language: true, timezone: true },
      });
      if (!user) return;

      const pref = await this.preferences.getOrCreate(userId);
      const content = build(user.language ?? 'en');

      if (
        !this.preferences.isAllowed(
          pref,
          content.category,
          content.urgency,
          user.timezone,
        )
      ) {
        return;
      }

      const tokens = await this.pushTokens.getEnabledTokens(userId);
      if (tokens.length === 0) return;

      const message: Omit<ExpoPushMessage, 'to'> = {
        title: content.title,
        body: content.body,
        data: content.data,
        sound: 'default',
        channelId: ANDROID_CHANNEL_ID,
        priority: content.urgency === 'urgent' ? 'high' : 'default',
      };

      const result = await this.expoPush.send(
        tokens.map((t) => t.token),
        message,
      );

      await this.pushTokens.markUsed(result.sentTokens);
      await this.pushTokens.disableTokens(
        result.invalidTokens,
        'DeviceNotRegistered',
      );
    } catch (error) {
      this.logger.error(`Failed to dispatch notification to user ${userId}`);
      Sentry.captureException(error, {
        extra: { userId, context: 'NotificationsService.dispatch' },
      });
    }
  }
}
