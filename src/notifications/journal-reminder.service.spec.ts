import { JournalReminderService } from './journal-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('JournalReminderService', () => {
  const now = new Date('2026-06-23T20:15:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function setup(delivered: boolean) {
    const pref = {
      userId: 'user-1',
      reminderHour: 20,
      lastReminderLocalDate: null,
      reminderClaimLocalDate: null,
      reminderClaimedAt: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      createdAt: new Date('2026-06-23T00:00:00.000Z'),
      journalRemindersEnabledAt: new Date('2026-06-23T00:00:00.000Z'),
      user: { timezone: 'UTC' },
    };
    const prisma = {
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([pref]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const notifications = {
      notifyJournalReminder: jest.fn().mockResolvedValue(delivered),
    };
    return {
      service: new JournalReminderService(
        prisma as unknown as PrismaService,
        notifications as unknown as NotificationsService,
      ),
      prisma,
      notifications,
      pref,
    };
  }

  it('leases a reminder before dispatch and marks it delivered afterwards', async () => {
    const { service, prisma, notifications } = setup(true);

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).toHaveBeenCalledWith('user-1');
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        pushEnabled: true,
        journalReminders: true,
        journalRemindersEnabledAt: new Date('2026-06-23T00:00:00.000Z'),
        AND: [
          {
            OR: [
              { lastReminderLocalDate: null },
              { lastReminderLocalDate: { lt: '2026-06-23' } },
            ],
          },
          {
            OR: [
              { reminderClaimLocalDate: null },
              {
                reminderClaimLocalDate: '2026-06-23',
                OR: [
                  { reminderClaimedAt: null },
                  {
                    reminderClaimedAt: {
                      lt: new Date('2026-06-23T20:00:00.000Z'),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      data: {
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: now,
      },
    });
    expect(
      prisma.notificationPreference.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      notifications.notifyJournalReminder.mock.invocationCallOrder[0],
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenLastCalledWith({
      where: {
        userId: 'user-1',
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: now,
        OR: [
          { lastReminderLocalDate: null },
          { lastReminderLocalDate: { lt: '2026-06-23' } },
        ],
      },
      data: {
        lastReminderLocalDate: '2026-06-23',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
  });

  it.each([
    ['a failed push', false],
    ['a suppressed or tokenless push', false],
  ])('leaves the reminder eligible after %s', async (_label, delivered) => {
    const { service, prisma } = setup(delivered);

    await service.sendDueReminders(now);

    expect(prisma.notificationPreference.updateMany).toHaveBeenLastCalledWith({
      where: {
        userId: 'user-1',
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: now,
      },
      data: {
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: null,
      },
    });
  });

  it('retries an undelivered reminder after its configured hour', async () => {
    const { service, prisma, notifications, pref } = setup(false);
    prisma.notificationPreference.findMany
      .mockResolvedValueOnce([pref])
      .mockResolvedValueOnce([
        {
          ...pref,
          reminderClaimLocalDate: '2026-06-23',
        },
      ]);

    await service.sendDueReminders(now);
    notifications.notifyJournalReminder.mockResolvedValueOnce(true);
    await service.sendDueReminders(new Date('2026-06-23T21:15:00.000Z'));

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(2);
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledTimes(4);
  });

  it('does not send a reminder before its configured hour', async () => {
    const { service, prisma, notifications } = setup(true);

    await service.sendDueReminders(new Date('2026-06-23T19:15:00.000Z'));

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('preserves a failed 23:00 reminder and retries its due date after midnight', async () => {
    const { service, prisma, notifications } = setup(false);
    const preference = {
      userId: 'user-1',
      reminderHour: 23,
      lastReminderLocalDate: '2026-06-22',
      reminderClaimLocalDate: null as string | null,
      reminderClaimedAt: null,
      quietHoursStart: null,
      quietHoursEnd: null,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
      user: { timezone: 'UTC' },
    };
    prisma.notificationPreference.findMany
      .mockResolvedValueOnce([preference])
      .mockResolvedValueOnce([
        {
          ...preference,
          reminderClaimLocalDate: '2026-06-23',
        },
      ]);

    await service.sendDueReminders(new Date('2026-06-23T23:15:00.000Z'));
    notifications.notifyJournalReminder.mockResolvedValueOnce(true);
    await service.sendDueReminders(new Date('2026-06-24T00:15:00.000Z'));

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(2);
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: null,
        },
      }),
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          lastReminderLocalDate: '2026-06-23',
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      }),
    );
  });

  it('recovers the previous due date when an outage spans the only 23:00 sweep', async () => {
    const { service, prisma, notifications } = setup(true);
    const afterMidnight = new Date('2026-06-24T00:15:00.000Z');
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'user-1',
        reminderHour: 23,
        lastReminderLocalDate: '2026-06-22',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
        quietHoursStart: null,
        quietHoursEnd: null,
        createdAt: new Date('2026-06-20T00:00:00.000Z'),
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
        user: { timezone: 'UTC' },
      },
    ]);

    jest.setSystemTime(afterMidnight);
    await service.sendDueReminders(afterMidnight);

    expect(notifications.notifyJournalReminder).toHaveBeenCalledWith('user-1');
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: afterMidnight,
        },
      }),
    );
  });

  it('skips a reminder that was already delivered today', async () => {
    const { service, prisma, notifications } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'user-1',
        reminderHour: 20,
        lastReminderLocalDate: '2026-06-23',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
        createdAt: new Date('2026-06-20T00:00:00.000Z'),
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
        user: { timezone: 'UTC' },
      },
    ]);

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('does not dispatch when another sweep already claimed the reminder', async () => {
    const { service, prisma, notifications } = setup(true);
    prisma.notificationPreference.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
  });

  it('treats a later delivered date as satisfying an older recalculated due date', async () => {
    const { service, prisma, notifications, pref } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        ...pref,
        reminderHour: 21,
        lastReminderLocalDate: '2026-06-23',
        createdAt: new Date('2026-06-20T00:00:00.000Z'),
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ]);

    // Moving the hour from 20:00 to 21:00 makes the calculated due date
    // 2026-06-22 even though 2026-06-23 was already delivered.
    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('uses an ordered atomic claim guard so a stale sweep cannot claim an older date', async () => {
    const { service, prisma, notifications, pref } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        ...pref,
        lastReminderLocalDate: '2026-06-22',
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ]);
    prisma.notificationPreference.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await service.sendDueReminders(now);

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        pushEnabled: true,
        journalReminders: true,
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
        AND: [
          {
            OR: [
              { lastReminderLocalDate: null },
              { lastReminderLocalDate: { lt: '2026-06-23' } },
            ],
          },
          {
            OR: [
              { reminderClaimLocalDate: null },
              {
                reminderClaimLocalDate: '2026-06-23',
                OR: [
                  { reminderClaimedAt: null },
                  {
                    reminderClaimedAt: {
                      lt: new Date('2026-06-23T20:00:00.000Z'),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      data: {
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: now,
      },
    });
    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
  });

  it('does not regress the delivered date if a later completion wins during dispatch', async () => {
    const { service, prisma, pref } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        ...pref,
        lastReminderLocalDate: '2026-06-22',
        journalRemindersEnabledAt: new Date('2026-06-20T00:00:00.000Z'),
      },
    ]);
    prisma.notificationPreference.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.sendDueReminders(now);

    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          userId: 'user-1',
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: now,
          OR: [
            { lastReminderLocalDate: null },
            { lastReminderLocalDate: { lt: '2026-06-23' } },
          ],
        },
        data: {
          lastReminderLocalDate: '2026-06-23',
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      3,
      {
        where: {
          userId: 'user-1',
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: now,
        },
        data: {
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
  });

  it('starts the schedule at the latest opt-in instead of backfilling the disabled period', async () => {
    const { service, prisma, notifications, pref } = setup(true);
    const reEnabledPreference = {
      ...pref,
      lastReminderLocalDate: '2026-06-21',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      journalRemindersEnabledAt: new Date('2026-06-23T19:00:00.000Z'),
    };
    prisma.notificationPreference.findMany.mockResolvedValue([
      reEnabledPreference,
    ]);

    await service.sendDueReminders(new Date('2026-06-23T19:15:00.000Z'));
    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(1);
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: now,
        },
      }),
    );
  });

  it('gives a later user a fresh lease timestamp even when the sweep instant is stale', async () => {
    const { service, prisma, notifications, pref } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      pref,
      {
        ...pref,
        userId: 'user-2',
      },
    ]);
    const laterClaimedAt = new Date('2026-06-23T20:31:00.000Z');
    notifications.notifyJournalReminder.mockImplementation((userId: string) => {
      if (userId === 'user-1') {
        jest.setSystemTime(laterClaimedAt);
      }
      return Promise.resolve(true);
    });

    await service.sendDueReminders(now);

    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      3,
      {
        where: {
          userId: 'user-2',
          pushEnabled: true,
          journalReminders: true,
          journalRemindersEnabledAt: new Date('2026-06-23T00:00:00.000Z'),
          AND: [
            {
              OR: [
                { lastReminderLocalDate: null },
                { lastReminderLocalDate: { lt: '2026-06-23' } },
              ],
            },
            {
              OR: [
                { reminderClaimLocalDate: null },
                {
                  reminderClaimLocalDate: '2026-06-23',
                  OR: [
                    { reminderClaimedAt: null },
                    {
                      reminderClaimedAt: {
                        lt: new Date('2026-06-23T20:16:00.000Z'),
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        data: {
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: laterClaimedAt,
        },
      },
    );
    expect(prisma.notificationPreference.updateMany).toHaveBeenNthCalledWith(
      4,
      {
        where: {
          userId: 'user-2',
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: laterClaimedAt,
          OR: [
            { lastReminderLocalDate: null },
            { lastReminderLocalDate: { lt: '2026-06-23' } },
          ],
        },
        data: {
          lastReminderLocalDate: '2026-06-23',
          reminderClaimLocalDate: null,
          reminderClaimedAt: null,
        },
      },
    );
  });

  it('reclaims an expired lease so a terminated worker cannot lose the reminder', async () => {
    const { service, prisma, notifications, pref } = setup(true);
    prisma.notificationPreference.findMany
      .mockResolvedValueOnce([pref])
      .mockResolvedValueOnce([
        {
          ...pref,
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: now,
        },
      ]);
    notifications.notifyJournalReminder.mockRejectedValueOnce(
      new Error('worker terminated'),
    );

    await service.sendDueReminders(now);
    const afterLeaseExpiry = new Date('2026-06-23T20:31:00.000Z');
    jest.setSystemTime(afterLeaseExpiry);
    await service.sendDueReminders(afterLeaseExpiry);

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(2);
  });
});
