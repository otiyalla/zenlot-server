import { JournalReminderService } from './journal-reminder.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('JournalReminderService', () => {
  const now = new Date('2026-06-23T20:15:00.000Z');

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
        AND: [
          {
            OR: [
              { lastReminderLocalDate: null },
              { lastReminderLocalDate: { not: '2026-06-23' } },
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
        user: { timezone: 'UTC' },
      },
    ]);

    await service.sendDueReminders(new Date('2026-06-24T00:15:00.000Z'));

    expect(notifications.notifyJournalReminder).toHaveBeenCalledWith('user-1');
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          reminderClaimLocalDate: '2026-06-23',
          reminderClaimedAt: new Date('2026-06-24T00:15:00.000Z'),
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
    await service.sendDueReminders(new Date('2026-06-23T20:31:00.000Z'));

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(2);
  });
});
