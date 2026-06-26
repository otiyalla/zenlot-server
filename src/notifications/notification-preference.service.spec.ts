import {
  NotificationPreferenceService,
  isWithinQuietHours,
} from './notification-preference.service';
import { PrismaService } from '../prisma/prisma.service';
import { notificationPreference } from '../../prisma/generated/prisma/client';
import { NotificationCategory } from './notification.types';

const basePref = (
  overrides: Partial<notificationPreference> = {},
): notificationPreference =>
  ({
    userId: 'u1',
    pushEnabled: true,
    tradeClosed: true,
    coachingReady: true,
    drawdownAlerts: true,
    governanceAlerts: true,
    journalReminders: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    reminderHour: 20,
    lastReminderLocalDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as notificationPreference;

describe('isWithinQuietHours', () => {
  // 2026-06-23T01:30:00Z — 01:30 in UTC.
  const at0130Utc = new Date('2026-06-23T01:30:00Z');

  it('returns false when either bound is missing', () => {
    expect(isWithinQuietHours(null, '07:00', 'UTC', at0130Utc)).toBe(false);
    expect(isWithinQuietHours('22:00', null, 'UTC', at0130Utc)).toBe(false);
  });

  it('handles a same-day window', () => {
    expect(isWithinQuietHours('01:00', '06:00', 'UTC', at0130Utc)).toBe(true);
    expect(isWithinQuietHours('02:00', '06:00', 'UTC', at0130Utc)).toBe(false);
  });

  it('handles a window that wraps midnight', () => {
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at0130Utc)).toBe(true);
    const at1200 = new Date('2026-06-23T12:00:00Z');
    expect(isWithinQuietHours('22:00', '07:00', 'UTC', at1200)).toBe(false);
  });

  it('evaluates in the user timezone (DST-aware)', () => {
    // 01:30 UTC is 21:30 the previous day in New York (EDT, -4 in June).
    expect(
      isWithinQuietHours('21:00', '23:00', 'America/New_York', at0130Utc),
    ).toBe(true);
    // ...and not quiet in Tokyo where it's 10:30.
    expect(isWithinQuietHours('21:00', '23:00', 'Asia/Tokyo', at0130Utc)).toBe(
      false,
    );
  });

  it('ignores malformed bounds rather than swallowing notifications', () => {
    expect(isWithinQuietHours('25:00', '07:00', 'UTC', at0130Utc)).toBe(false);
    expect(isWithinQuietHours('22:00', '7am', 'UTC', at0130Utc)).toBe(false);
  });
});

describe('NotificationPreferenceService.isAllowed', () => {
  const service = new NotificationPreferenceService({} as PrismaService);
  const now = new Date('2026-06-23T01:30:00Z');

  it('blocks everything when the master switch is off', () => {
    const pref = basePref({ pushEnabled: false });
    expect(
      service.isAllowed(
        pref,
        NotificationCategory.TradeClosed,
        'urgent',
        'UTC',
        now,
      ),
    ).toBe(false);
  });

  it('blocks a category whose toggle is off', () => {
    const pref = basePref({ tradeClosed: false });
    expect(
      service.isAllowed(
        pref,
        NotificationCategory.TradeClosed,
        'urgent',
        'UTC',
        now,
      ),
    ).toBe(false);
  });

  it('lets urgent notifications through quiet hours', () => {
    const pref = basePref({ quietHoursStart: '00:00', quietHoursEnd: '06:00' });
    expect(
      service.isAllowed(
        pref,
        NotificationCategory.TradeClosed,
        'urgent',
        'UTC',
        now,
      ),
    ).toBe(true);
  });

  it('suppresses gentle notifications inside quiet hours', () => {
    const pref = basePref({ quietHoursStart: '00:00', quietHoursEnd: '06:00' });
    expect(
      service.isAllowed(
        pref,
        NotificationCategory.JournalReminder,
        'gentle',
        'UTC',
        now,
      ),
    ).toBe(false);
  });

  it('allows gentle notifications outside quiet hours', () => {
    const pref = basePref({ quietHoursStart: '08:00', quietHoursEnd: '09:00' });
    expect(
      service.isAllowed(
        pref,
        NotificationCategory.JournalReminder,
        'gentle',
        'UTC',
        now,
      ),
    ).toBe(true);
  });
});
