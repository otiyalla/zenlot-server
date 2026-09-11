import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { notificationPreference } from '../../prisma/generated/prisma/client';
import {
  CATEGORY_PREFERENCE_KEY,
  NotificationCategory,
  NotificationUrgency,
} from './notification.types';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { isJournalReminderClaimActive } from './journal-reminder-lease';

@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the user's preferences, lazily creating the row with supportive
   * defaults (everything on, no quiet hours) on first access.
   */
  async getOrCreate(userId: string): Promise<notificationPreference> {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.notificationPreference.create({ data: { userId } });
  }

  async update(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<notificationPreference> {
    // Ensure a row exists, then patch only the provided fields.
    let existing = await this.getOrCreate(userId);

    if (
      dto.pushEnabled !== true &&
      dto.journalReminders !== true &&
      dto.reminderHour === undefined
    ) {
      return this.prisma.notificationPreference.update({
        where: { userId },
        data: { ...dto },
      });
    }

    // Compare-and-swap on both toggles so overlapping master/category updates
    // cannot change whether reminders are effectively enabled without forcing a
    // retry. On retry, the latest state is observed and the request that
    // completes a false-to-true effective transition records its boundary.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const remindersWereEnabled =
        existing.pushEnabled && existing.journalReminders;
      const remindersWillBeEnabled =
        (dto.pushEnabled ?? existing.pushEnabled) &&
        (dto.journalReminders ?? existing.journalReminders);
      const journalRemindersReEnabled =
        !remindersWereEnabled && remindersWillBeEnabled;
      const reminderHourChanged =
        dto.reminderHour !== undefined &&
        dto.reminderHour !== existing.reminderHour;
      const claimMustBeRevalidated = reminderHourChanged;
      const preserveActiveBasisChangeClaim =
        reminderHourChanged &&
        isJournalReminderClaimActive(
          existing.reminderClaimLocalDate,
          existing.reminderClaimedAt,
          new Date(),
        );
      const update = await this.prisma.notificationPreference.updateMany({
        where: {
          userId,
          pushEnabled: existing.pushEnabled,
          journalReminders: existing.journalReminders,
          ...(dto.reminderHour !== undefined
            ? { reminderHour: existing.reminderHour }
            : {}),
          ...(claimMustBeRevalidated
            ? {
                reminderClaimLocalDate: existing.reminderClaimLocalDate,
                reminderClaimedAt: existing.reminderClaimedAt,
              }
            : {}),
        },
        data: {
          ...dto,
          ...((journalRemindersReEnabled || claimMustBeRevalidated) &&
          !preserveActiveBasisChangeClaim
            ? {
                reminderClaimLocalDate: null,
                reminderClaimedAt: null,
              }
            : {}),
          ...(journalRemindersReEnabled
            ? { journalRemindersEnabledAt: new Date() }
            : {}),
        },
      });

      if (update.count === 1) {
        const updated = await this.prisma.notificationPreference.findUnique({
          where: { userId },
        });
        if (!updated) {
          throw new Error(`Notification preferences disappeared for ${userId}`);
        }
        return updated;
      }

      const refreshed = await this.prisma.notificationPreference.findUnique({
        where: { userId },
      });
      if (!refreshed) {
        throw new Error(`Notification preferences disappeared for ${userId}`);
      }
      existing = refreshed;
    }

    throw new Error(
      `Notification preferences changed too frequently for ${userId}`,
    );
  }

  /**
   * Whether a given category may be delivered to a user right now, taking the
   * master switch, the per-category toggle, and quiet hours into account.
   * Urgent notifications ignore quiet hours; gentle ones are suppressed inside
   * the window. Quiet-hours evaluation uses the user's IANA timezone so it is
   * DST-correct (no stored numeric offsets), matching the drawdown reset.
   */
  isAllowed(
    pref: notificationPreference,
    category: NotificationCategory,
    urgency: NotificationUrgency,
    timezone: string | null | undefined,
    now: Date = new Date(),
  ): boolean {
    if (!pref.pushEnabled) return false;

    const key = CATEGORY_PREFERENCE_KEY[
      category
    ] as keyof notificationPreference;
    if (pref[key] === false) return false;

    if (urgency === 'urgent') return true;

    return !isWithinQuietHours(
      pref.quietHoursStart,
      pref.quietHoursEnd,
      timezone,
      now,
    );
  }
}

/**
 * True when `now`, expressed in the user's local timezone, falls inside the
 * quiet-hours window [start, end). Both bounds are "HH:mm" 24h strings. Supports
 * windows that wrap midnight (e.g. 22:00 → 07:00). Returns false (i.e. not
 * quiet) when either bound is missing or malformed, so a bad value never
 * silently swallows notifications.
 */
export function isWithinQuietHours(
  start: string | null,
  end: string | null,
  timezone: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!start || !end) return false;
  const startMin = parseHhMm(start);
  const endMin = parseHhMm(end);
  if (startMin === null || endMin === null) return false;
  if (startMin === endMin) return false; // zero-width window — treat as off.

  const nowMin = localMinutes(now, timezone);

  if (startMin < endMin) {
    // Same-day window, e.g. 01:00 → 06:00.
    return nowMin >= startMin && nowMin < endMin;
  }
  // Wraps midnight, e.g. 22:00 → 07:00.
  return nowMin >= startMin || nowMin < endMin;
}

function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes-since-midnight for `now` in the given IANA timezone (UTC fallback). */
function localMinutes(now: Date, timezone: string | null | undefined): number {
  const tz = timezone || 'UTC';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0';
  // Intl can emit '24' for midnight in some engines — normalise to 0.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return hour * 60 + minute;
}
