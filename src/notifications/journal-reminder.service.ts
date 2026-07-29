import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Sends the daily journaling / discipline nudge. Intended to run hourly; for
 * each opted-in user it becomes due once per local day at the user's configured
 * local `reminderHour`, using their IANA timezone. DST-safe (no stored offsets)
 * and idempotent across retries via `lastReminderLocalDate` — the same pattern
 * the drawdown circuit-breaker reset uses.
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
        const { date, hour } = localDateHour(now, pref.user?.timezone);
        const persistedDueDate =
          pref.reminderClaimLocalDate !== pref.lastReminderLocalDate
            ? pref.reminderClaimLocalDate
            : null;
        const dueDate =
          persistedDueDate ??
          latestReminderDueDate(date, hour, pref.reminderHour);

        // Do not backfill a reminder from before the latest opt-in. Existing
        // rows are migrated with createdAt as this boundary, preserving the
        // historical behavior until the category is explicitly re-enabled.
        if (
          preferenceWasEnabledAfterDueDate(
            pref.journalRemindersEnabledAt,
            pref.user?.timezone,
            dueDate,
            pref.reminderHour,
          )
        ) {
          continue;
        }
        // ISO local dates sort chronologically. A later delivery also satisfies
        // an older due date that can appear after reminderHour is moved later.
        if (
          pref.lastReminderLocalDate &&
          pref.lastReminderLocalDate >= dueDate
        ) {
          continue;
        }

        // Lease the due date before crossing the push-transport boundary. The
        // date remains persisted after retryable failures, so a local-midnight
        // rollover cannot turn an outstanding reminder into today's schedule.
        const claimedAt = new Date();
        const leaseExpiresBefore = new Date(
          claimedAt.getTime() - JournalReminderService.CLAIM_LEASE_MS,
        );
        const claim = await this.prisma.notificationPreference.updateMany({
          where: {
            userId: pref.userId,
            pushEnabled: true,
            journalReminders: true,
            journalRemindersEnabledAt: pref.journalRemindersEnabledAt,
            AND: [
              {
                OR: [
                  { lastReminderLocalDate: null },
                  { lastReminderLocalDate: { lt: dueDate } },
                ],
              },
              {
                OR: [
                  { reminderClaimLocalDate: null },
                  {
                    reminderClaimLocalDate: dueDate,
                    OR: [
                      { reminderClaimedAt: null },
                      { reminderClaimedAt: { lt: leaseExpiresBefore } },
                    ],
                  },
                ],
              },
            ],
          },
          data: {
            reminderClaimLocalDate: dueDate,
            reminderClaimedAt: claimedAt,
          },
        });
        if (claim.count === 0) continue;

        const delivered = await this.notifications.notifyJournalReminder(
          pref.userId,
        );
        // Complete or release only the lease owned by this attempt, so a slow
        // worker cannot overwrite a replacement lease after its own expires.
        if (delivered) {
          const completion =
            await this.prisma.notificationPreference.updateMany({
              where: {
                userId: pref.userId,
                reminderClaimLocalDate: dueDate,
                reminderClaimedAt: claimedAt,
                OR: [
                  { lastReminderLocalDate: null },
                  { lastReminderLocalDate: { lt: dueDate } },
                ],
              },
              data: {
                lastReminderLocalDate: dueDate,
                reminderClaimLocalDate: null,
                reminderClaimedAt: null,
              },
            });

          // A newer delivery may have won while this worker was sending. Release
          // only this attempt's lease without overwriting the later date.
          if (completion.count === 0) {
            await this.prisma.notificationPreference.updateMany({
              where: {
                userId: pref.userId,
                reminderClaimLocalDate: dueDate,
                reminderClaimedAt: claimedAt,
              },
              data: {
                reminderClaimLocalDate: null,
                reminderClaimedAt: null,
              },
            });
          }
        } else {
          await this.prisma.notificationPreference.updateMany({
            where: {
              userId: pref.userId,
              reminderClaimLocalDate: dueDate,
              reminderClaimedAt: claimedAt,
            },
            data: {
              reminderClaimLocalDate: dueDate,
              reminderClaimedAt: null,
            },
          });
        }
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

function latestReminderDueDate(
  localDate: string,
  localHour: number,
  reminderHour: number,
): string {
  if (localHour >= reminderHour) return localDate;

  const previousDate = new Date(`${localDate}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return previousDate.toISOString().slice(0, 10);
}

function preferenceWasEnabledAfterDueDate(
  enabledAt: Date,
  timezone: string | null | undefined,
  dueDate: string,
  reminderHour: number,
): boolean {
  const enabled = localDateHour(enabledAt, timezone);
  if (enabled.date !== dueDate) return enabled.date > dueDate;
  return enabled.hour * 60 + enabled.minute > reminderHour * 60;
}
