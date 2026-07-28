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
    };
  }

  it('durably claims a reminder before dispatch', async () => {
    const { service, prisma, notifications } = setup(true);

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).toHaveBeenCalledWith('user-1');
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        NOT: { lastReminderLocalDate: '2026-06-23' },
      },
      data: { lastReminderLocalDate: '2026-06-23' },
    });
    expect(
      prisma.notificationPreference.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      notifications.notifyJournalReminder.mock.invocationCallOrder[0],
    );
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
        lastReminderLocalDate: '2026-06-23',
      },
      data: { lastReminderLocalDate: null },
    });
  });

  it('retries an undelivered reminder after its configured hour', async () => {
    const { service, prisma, notifications } = setup(false);

    await service.sendDueReminders(now);
    notifications.notifyJournalReminder.mockResolvedValueOnce(true);
    await service.sendDueReminders(new Date('2026-06-23T21:15:00.000Z'));

    expect(notifications.notifyJournalReminder).toHaveBeenCalledTimes(2);
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledTimes(3);
  });

  it('does not send a reminder before its configured hour', async () => {
    const { service, prisma, notifications } = setup(true);

    await service.sendDueReminders(new Date('2026-06-23T19:15:00.000Z'));

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('skips a reminder that was already delivered today', async () => {
    const { service, prisma, notifications } = setup(true);
    prisma.notificationPreference.findMany.mockResolvedValueOnce([
      {
        userId: 'user-1',
        reminderHour: 20,
        lastReminderLocalDate: '2026-06-23',
        user: { timezone: 'UTC' },
      },
    ]);

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('does not dispatch when another sweep already claimed the reminder', async () => {
    const { service, prisma, notifications } = setup(true);
    prisma.notificationPreference.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.sendDueReminders(now);

    expect(notifications.notifyJournalReminder).not.toHaveBeenCalled();
  });
});
