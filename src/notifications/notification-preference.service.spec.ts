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
    journalRemindersEnabledAt: new Date(),
    quietHoursStart: null,
    quietHoursEnd: null,
    reminderHour: 20,
    lastReminderLocalDate: null,
    reminderClaimLocalDate: null,
    reminderClaimedAt: null,
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

describe('NotificationPreferenceService.update', () => {
  const reEnabledAt = new Date('2026-06-23T19:00:00.000Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(existing: notificationPreference) {
    const prisma = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(existing),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    return {
      service: new NotificationPreferenceService(
        prisma as unknown as PrismaService,
      ),
      prisma,
    };
  }

  it('records the actual re-enable boundary and clears an older claim', async () => {
    jest.useFakeTimers().setSystemTime(reEnabledAt);
    const { service, prisma } = setup(
      basePref({
        journalReminders: false,
        journalRemindersEnabledAt: new Date('2026-06-20T12:00:00.000Z'),
        reminderClaimLocalDate: '2026-06-22',
        reminderClaimedAt: new Date('2026-06-22T20:00:00.000Z'),
      }),
    );

    await service.update('u1', { journalReminders: true });

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        pushEnabled: true,
        journalReminders: false,
      },
      data: {
        journalReminders: true,
        journalRemindersEnabledAt: reEnabledAt,
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
  });

  it('clears a persisted claim when reminderHour changes', async () => {
    const enabledAt = new Date('2026-06-20T12:00:00.000Z');
    const { service, prisma } = setup(
      basePref({
        journalReminders: true,
        journalRemindersEnabledAt: enabledAt,
        reminderClaimLocalDate: '2026-06-22',
        reminderClaimedAt: new Date('2026-06-22T20:00:00.000Z'),
      }),
    );

    await service.update('u1', {
      journalReminders: true,
      reminderHour: 21,
    });

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        pushEnabled: true,
        journalReminders: true,
        reminderHour: 20,
      },
      data: {
        journalReminders: true,
        reminderHour: 21,
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
  });

  it('does not clear a persisted claim when the same reminderHour is supplied', async () => {
    const { service, prisma } = setup(
      basePref({
        reminderClaimLocalDate: '2026-06-22',
        reminderClaimedAt: new Date('2026-06-22T20:00:00.000Z'),
      }),
    );

    await service.update('u1', { reminderHour: 20 });

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        pushEnabled: true,
        journalReminders: true,
        reminderHour: 20,
      },
      data: { reminderHour: 20 },
    });
  });

  it('retries a same-value reminderHour update if the basis changed concurrently', async () => {
    const initiallyAtRequestedHour = basePref({ reminderHour: 20 });
    const concurrentlyChanged = basePref({
      reminderHour: 19,
      reminderClaimLocalDate: '2026-06-22',
      reminderClaimedAt: new Date('2026-06-22T19:00:00.000Z'),
    });
    const { service, prisma } = setup(initiallyAtRequestedHour);
    prisma.notificationPreference.findUnique
      .mockReset()
      .mockResolvedValueOnce(initiallyAtRequestedHour)
      .mockResolvedValueOnce(concurrentlyChanged)
      .mockResolvedValueOnce(basePref({ reminderHour: 20 }));
    prisma.notificationPreference.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.update('u1', { reminderHour: 20 });

    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          userId: 'u1',
          pushEnabled: true,
          journalReminders: true,
          reminderHour: 20,
        },
        data: { reminderHour: 20 },
      },
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          userId: 'u1',
          pushEnabled: true,
          journalReminders: true,
          reminderHour: 19,
        },
        data: {
          reminderHour: 20,
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
  });

  it('does not clear a persisted claim for an unrelated preference update', async () => {
    const { service, prisma } = setup(
      basePref({
        reminderClaimLocalDate: '2026-06-22',
        reminderClaimedAt: new Date('2026-06-22T20:00:00.000Z'),
      }),
    );

    await service.update('u1', { quietHoursStart: '22:00' });

    expect(prisma.notificationPreference.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { quietHoursStart: '22:00' },
    });
  });

  it('does not move the opt-in boundary when reminders are disabled', async () => {
    const { service, prisma } = setup(basePref());

    await service.update('u1', { journalReminders: false });

    expect(prisma.notificationPreference.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { journalReminders: false },
    });
  });

  it('treats master push re-enable as a new effective reminder boundary', async () => {
    jest.useFakeTimers().setSystemTime(reEnabledAt);
    const { service, prisma } = setup(
      basePref({
        pushEnabled: false,
        journalReminders: true,
        journalRemindersEnabledAt: new Date('2026-06-20T12:00:00.000Z'),
        reminderClaimLocalDate: '2026-06-22',
        reminderClaimedAt: new Date('2026-06-22T20:00:00.000Z'),
      }),
    );

    await service.update('u1', { pushEnabled: true });

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        pushEnabled: false,
        journalReminders: true,
      },
      data: {
        pushEnabled: true,
        journalRemindersEnabledAt: reEnabledAt,
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
  });

  it('does not move the reminder boundary when master push is enabled while reminders remain disabled', async () => {
    const { service, prisma } = setup(
      basePref({
        pushEnabled: false,
        journalReminders: false,
      }),
    );

    await service.update('u1', { pushEnabled: true });

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        pushEnabled: false,
        journalReminders: false,
      },
      data: {
        pushEnabled: true,
      },
    });
  });

  it('retries a master re-enable against a concurrent reminder disable without creating a boundary', async () => {
    jest.useFakeTimers().setSystemTime(reEnabledAt);
    const initiallyMasterDisabled = basePref({
      pushEnabled: false,
      journalReminders: true,
    });
    const concurrentlyRemindersDisabled = basePref({
      pushEnabled: false,
      journalReminders: false,
    });
    const { service, prisma } = setup(initiallyMasterDisabled);
    prisma.notificationPreference.findUnique
      .mockReset()
      .mockResolvedValueOnce(initiallyMasterDisabled)
      .mockResolvedValueOnce(concurrentlyRemindersDisabled)
      .mockResolvedValueOnce(
        basePref({
          pushEnabled: true,
          journalReminders: false,
        }),
      );
    prisma.notificationPreference.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.update('u1', { pushEnabled: true });

    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          userId: 'u1',
          pushEnabled: false,
          journalReminders: true,
        },
        data: {
          pushEnabled: true,
          journalRemindersEnabledAt: reEnabledAt,
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          userId: 'u1',
          pushEnabled: false,
          journalReminders: false,
        },
        data: {
          pushEnabled: true,
        },
      },
    );
  });

  it('retries against a concurrent disable and records the resulting re-enable', async () => {
    jest.useFakeTimers().setSystemTime(reEnabledAt);
    const initiallyEnabled = basePref({ journalReminders: true });
    const concurrentlyDisabled = basePref({ journalReminders: false });
    const { service, prisma } = setup(initiallyEnabled);
    prisma.notificationPreference.findUnique
      .mockReset()
      .mockResolvedValueOnce(initiallyEnabled)
      .mockResolvedValueOnce(concurrentlyDisabled)
      .mockResolvedValueOnce(
        basePref({
          journalReminders: true,
          journalRemindersEnabledAt: reEnabledAt,
        }),
      );
    prisma.notificationPreference.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.update('u1', { journalReminders: true });

    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          userId: 'u1',
          pushEnabled: true,
          journalReminders: true,
        },
        data: { journalReminders: true },
      },
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          userId: 'u1',
          pushEnabled: true,
          journalReminders: false,
        },
        data: {
          journalReminders: true,
          journalRemindersEnabledAt: reEnabledAt,
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
  });
});
