import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Sends the daily journaling / discipline nudge. Intended to run hourly; for
 * each opted-in user it fires exactly once per local day, at the user's
 * configured local `reminderHour`, using their IANA timezone. DST-safe (no
 * stored offsets) and idempotent across retries via `lastReminderLocalDate` —
 * the same pattern the drawdown circuit-breaker reset uses.
 */
@Injectable()
export class JournalReminderService {
  private readonly logger = new Logger(JournalReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sendDueReminders(now: Date = new Date()): Promise<void> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { pushEnabled: true, journalReminders: true },
      include: { user: { select: { timezone: true } } },
    });

    for (const pref of prefs) {
      try {
        const { date, hour } = localDateHour(now, pref.user?.timezone);

        // Once the configured hour has arrived, keep the reminder due for the
        // rest of the local day. This lets later hourly sweeps retry temporary
        // push failures and reminders initially suppressed by quiet hours.
        if (hour < pref.reminderHour) continue;
        if (pref.lastReminderLocalDate === date) continue;

        // Only mark the date after a push was accepted. Failed, suppressed, or
        // tokenless deliveries must remain eligible for a later retry.
        const delivered = await this.notifications.notifyJournalReminder(
          pref.userId,
        );
        if (!delivered) continue;

        await this.prisma.notificationPreference.update({
          where: { userId: pref.userId },
          data: { lastReminderLocalDate: date },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to send journal reminder for user ${pref.userId}`,
        );
        Sentry.captureException(error, {
          extra: {
            userId: pref.userId,
            context: 'JournalReminderService.sendDueReminders',
          },
        });
      }
    }
  }
}

/**
 * Resolves an instant into the user's local YYYY-MM-DD date and 0-23 hour using
 * their IANA timezone (UTC fallback for missing/invalid names, so one bad value
 * can't break the whole loop).
 */
export function localDateHour(
  now: Date,
  timezone: string | null | undefined,
): { date: string; hour: number } {
  const tz = timezone || 'UTC';
  const fmt = (zone: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(tz);
  } catch {
    parts = fmt('UTC');
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour')) % 24;
  return { date, hour };
}
