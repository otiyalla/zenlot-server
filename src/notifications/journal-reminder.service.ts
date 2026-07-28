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
  private static readonly CLAIM_LEASE_MS = 15 * 60 * 1000;
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
        const { date, hour, minute } = localDateHour(now, pref.user?.timezone);

        // Once the configured hour has arrived, keep the reminder due for the
        // rest of the local day. This lets later hourly sweeps retry temporary
        // push failures and reminders initially suppressed by quiet hours.
        if (
          hour < pref.reminderHour &&
          !isOvernightQuietHoursCarryoverDue(
            pref.reminderHour,
            pref.quietHoursStart,
            pref.quietHoursEnd,
            hour * 60 + minute,
          )
        ) {
          continue;
        }
        if (pref.lastReminderLocalDate === date) continue;

        // Lease the local date before crossing the push-transport boundary.
        // The lease serialises concurrent sweeps but, unlike the delivered
        // marker, becomes recoverable if this worker exits before dispatch.
        const leaseExpiresBefore = new Date(
          now.getTime() - JournalReminderService.CLAIM_LEASE_MS,
        );
        const claim = await this.prisma.notificationPreference.updateMany({
          where: {
            userId: pref.userId,
            OR: [
              { lastReminderLocalDate: null },
              { lastReminderLocalDate: { not: date } },
            ],
            AND: [
              {
                OR: [
                  { reminderClaimLocalDate: { not: date } },
                  { reminderClaimedAt: null },
                  { reminderClaimedAt: { lt: leaseExpiresBefore } },
                ],
              },
            ],
          },
          data: {
            reminderClaimLocalDate: date,
            reminderClaimedAt: now,
          },
        });
        if (claim.count === 0) continue;

        const delivered = await this.notifications.notifyJournalReminder(
          pref.userId,
        );
        // Complete or release only the lease owned by this attempt, so a slow
        // worker cannot overwrite a replacement lease after its own expires.
        await this.prisma.notificationPreference.updateMany({
          where: {
            userId: pref.userId,
            reminderClaimLocalDate: date,
            reminderClaimedAt: now,
          },
          data: delivered
            ? {
                lastReminderLocalDate: date,
                reminderClaimLocalDate: null,
                reminderClaimedAt: null,
              }
            : {
                reminderClaimLocalDate: null,
                reminderClaimedAt: null,
              },
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
): { date: string; hour: number; minute: number } {
  const tz = timezone || 'UTC';
  const fmt = (zone: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
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
  const minute = Number(get('minute'));
  return { date, hour, minute };
}

/**
 * A reminder configured in the evening portion of quiet hours cannot be sent
 * before midnight. Keep it due after the wrapping window ends the next morning
 * instead of waiting for the same suppressed hour again.
 */
function isOvernightQuietHoursCarryoverDue(
  reminderHour: number,
  quietHoursStart: string | null,
  quietHoursEnd: string | null,
  localMinute: number,
): boolean {
  const start = parseHhMm(quietHoursStart);
  const end = parseHhMm(quietHoursEnd);
  if (start === null || end === null || start <= end) return false;

  const reminderMinute = reminderHour * 60;
  return (
    reminderMinute >= start &&
    localMinute >= end &&
    localMinute < reminderMinute
  );
}

function parseHhMm(value: string | null): number | null {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
