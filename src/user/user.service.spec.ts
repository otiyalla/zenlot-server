import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGateway } from './user.gateway';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UserService', () => {
  let service: UserService;
  let prisma: any;
  let audit: any;
  let analytics: any;
  let email: any;
  let queue: any;
  let socketSessions: any;
  let userGateway: any;

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
      notificationPreference: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };
    audit = { log: jest.fn() };
    analytics = {
      trackAccountDeleted: jest.fn(),
      trackAccountDeletionCancelled: jest.fn(),
      trackUserUpdated: jest.fn(),
    };
    email = {
      sendAccountDeletionCancelledNotice: jest.fn(),
    };
    queue = { getJob: jest.fn() };
    socketSessions = { advanceAuthVersion: jest.fn() };
    userGateway = { emitUserUpdate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: UserGateway,
          useValue: userGateway,
        },
        {
          provide: AuditService,
          useValue: audit,
        },
        {
          provide: EmailService,
          useValue: email,
        },
        {
          provide: AnalyticsService,
          useValue: analytics,
        },
        {
          provide: SocketSessionRegistry,
          useValue: socketSessions,
        },
        {
          provide: getQueueToken('deletion'),
          useValue: queue,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each([
    ['profile changes', { fname: 'Updated', theme: 'dark' }],
    ['an empty patch', {}],
  ])('returns the updated user for %s', async (_label, dto) => {
    const updatedUser = {
      id: 'user-1',
      fname: 'Updated',
      email: 'trader@example.com',
      password: 'hashed-password',
      emailVerificationToken: 'verification-secret',
      emailVerificationTokenExpiry: new Date('2026-08-01'),
    };
    prisma.user.update.mockResolvedValue(updatedUser);

    const result = await service.update('user-1', dto as UpdateUserDto);

    expect(result).toEqual({
      id: 'user-1',
      fname: 'Updated',
      email: 'trader@example.com',
    });
    expect(userGateway.emitUserUpdate).toHaveBeenCalledWith(
      'user-1',
      updatedUser,
    );
    expect(prisma.notificationPreference.create).not.toHaveBeenCalled();
  });

  it('does not create notification preferences solely to clear a timezone claim', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC' });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      timezone: 'Europe/London',
    });
    prisma.notificationPreference.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    await service.update('user-1', {
      timezone: 'Europe/London',
    } as UpdateUserDto);

    expect(prisma.notificationPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        reminderHour: true,
        lastReminderLocalDate: true,
        reminderClaimLocalDate: true,
        reminderClaimedAt: true,
      },
    });
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.create).not.toHaveBeenCalled();
  });

  it('atomically clears an outstanding reminder claim on an explicit timezone update', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T20:05:00.000Z'));
    const updatedUser = {
      id: 'user-1',
      email: 'trader@example.com',
      password: 'hashed-password',
      timezone: 'America/Toronto',
    };
    prisma.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC' });
    prisma.user.update.mockResolvedValue(updatedUser);
    prisma.notificationPreference.findUnique.mockResolvedValue({
      reminderHour: 20,
      lastReminderLocalDate: '2026-06-22',
      reminderClaimLocalDate: '2026-06-23',
      reminderClaimedAt: null,
    });

    const result = await service.update('user-1', {
      timezone: 'America/Toronto',
    } as UpdateUserDto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1', timezone: 'UTC' },
      data: {
        timezone: 'America/Toronto',
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        reminderHour: 20,
        lastReminderLocalDate: '2026-06-22',
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: null,
      },
      data: {
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
    expect(result).toEqual({
      id: 'user-1',
      email: 'trader@example.com',
      timezone: 'America/Toronto',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        changes: {
          updated: {
            timezone: 'America/Toronto',
            updatedAt: expect.any(Date),
          },
        },
      }),
    );
    expect(analytics.trackUserUpdated).toHaveBeenCalledWith('user-1', [
      'timezone',
    ]);
    expect(userGateway.emitUserUpdate).toHaveBeenCalledWith(
      'user-1',
      updatedUser,
    );
  });

  it('preserves an active reminder claim when the supplied timezone is unchanged', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC' });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      timezone: 'UTC',
    });

    await service.update('user-1', {
      timezone: 'UTC',
    } as UpdateUserDto);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1', timezone: 'UTC' },
      data: {
        timezone: 'UTC',
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('preserves an active reminder claim when the timezone changes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T23:05:00.000Z'));
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      timezone: 'Asia/Tokyo',
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Los_Angeles',
    });
    const claimedAt = new Date('2026-06-23T23:00:00.000Z');
    prisma.notificationPreference.findUnique.mockResolvedValue({
      reminderHour: 8,
      lastReminderLocalDate: '2026-06-23',
      reminderClaimLocalDate: '2026-06-24',
      reminderClaimedAt: claimedAt,
    });

    await service.update('user-1', {
      timezone: 'America/Los_Angeles',
    } as UpdateUserDto);

    expect(prisma.notificationPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        reminderHour: 8,
        lastReminderLocalDate: '2026-06-23',
        reminderClaimLocalDate: '2026-06-24',
        reminderClaimedAt: claimedAt,
      },
      data: {
        reminderClaimLocalDate: '2026-06-23',
        reminderClaimedAt: claimedAt,
      },
    });
    expect(
      prisma.notificationPreference.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.user.update.mock.invocationCallOrder[0]);
  });

  it('retries and rebases a delivery that wins the timezone preference CAS', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-23T23:05:00.000Z'));
    const claimedAt = new Date('2026-06-23T23:00:00.000Z');
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      timezone: 'Asia/Tokyo',
    });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Los_Angeles',
    });
    prisma.notificationPreference.findUnique
      .mockResolvedValueOnce({
        reminderHour: 8,
        lastReminderLocalDate: '2026-06-23',
        reminderClaimLocalDate: '2026-06-24',
        reminderClaimedAt: claimedAt,
      })
      .mockResolvedValueOnce({
        reminderHour: 8,
        lastReminderLocalDate: '2026-06-24',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      });
    prisma.notificationPreference.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await service.update('user-1', {
      timezone: 'America/Los_Angeles',
    } as UpdateUserDto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.notificationPreference.updateMany).toHaveBeenLastCalledWith({
      where: {
        userId: 'user-1',
        reminderHour: 8,
        lastReminderLocalDate: '2026-06-24',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
      data: {
        lastReminderLocalDate: '2026-06-23',
        reminderClaimLocalDate: null,
        reminderClaimedAt: null,
      },
    });
  });

  it('retries and re-evaluates claim clearing after a concurrent timezone change', async () => {
    prisma.user.findUniqueOrThrow
      .mockResolvedValueOnce({ timezone: 'UTC' })
      .mockResolvedValueOnce({ timezone: 'America/Toronto' });
    prisma.user.update
      .mockRejectedValueOnce({ code: 'P2025' })
      .mockResolvedValueOnce({
        id: 'user-1',
        timezone: 'UTC',
      });

    await service.update('user-1', {
      timezone: 'UTC',
    } as UpdateUserDto);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-1', timezone: 'UTC' },
      data: {
        timezone: 'UTC',
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-1', timezone: 'America/Toronto' },
      data: {
        timezone: 'UTC',
        updatedAt: expect.any(Date),
      },
    });
    expect(prisma.notificationPreference.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('does not emit update side effects when atomic claim clearing fails', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ timezone: 'UTC' });
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      timezone: 'America/Toronto',
    });
    prisma.notificationPreference.findUnique.mockResolvedValue({
      reminderHour: 20,
      lastReminderLocalDate: '2026-06-22',
      reminderClaimLocalDate: '2026-06-23',
      reminderClaimedAt: null,
    });
    prisma.notificationPreference.updateMany.mockRejectedValue(
      new Error('claim clear failed'),
    );

    await expect(
      service.update('user-1', {
        timezone: 'America/Toronto',
      } as UpdateUserDto),
    ).rejects.toThrow('claim clear failed');

    expect(audit.log).not.toHaveBeenCalled();
    expect(analytics.trackUserUpdated).not.toHaveBeenCalled();
    expect(userGateway.emitUserUpdate).not.toHaveBeenCalled();
  });

  it('does not clear reminder claims or open a transaction for unrelated user updates', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      fname: 'Updated',
      password: 'hashed-password',
    });

    await service.update('user-1', {
      fname: 'Updated',
    } as UpdateUserDto);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.notificationPreference.updateMany).not.toHaveBeenCalled();
  });

  it('revokes existing refresh tokens after a password reset', async () => {
    const prisma = {
      user: {
        update: jest.fn().mockResolvedValue({ id: 'user-1', authVersion: 4 }),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };
    (service as any).prisma = prisma;

    await service.resetPassword('user-1', 'new-password');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        password: expect.any(String),
        authVersion: { increment: 1 },
      },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isRevoked: false },
      data: { isRevoked: true },
    });
    expect(socketSessions.advanceAuthVersion).toHaveBeenCalledWith('user-1', 4);
  });

  it('fails the password reset when refresh-token revocation fails', async () => {
    const revocationError = new Error('refresh-token database unavailable');
    const prisma = {
      user: { update: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      refreshToken: {
        updateMany: jest.fn().mockRejectedValue(revocationError),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };
    (service as any).prisma = prisma;

    await expect(service.resetPassword('user-1', 'new-password')).rejects.toBe(
      revocationError,
    );
    expect(socketSessions.advanceAuthVersion).not.toHaveBeenCalled();
  });

  it('permanently deletes a due scheduled account and records the audit', async () => {
    prisma.user.findUnique.mockResolvedValue({
      deletedAt: new Date('2026-01-01'),
      deleteScheduledFor: new Date('2026-01-02'),
    });
    prisma.user.deleteMany.mockResolvedValue({ count: 1 });

    await service.permanentlyDeleteUser('user-1');

    expect(prisma.user.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'user-1' }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ACCOUNT_DELETED', userId: 'user-1' }),
    );
    expect(analytics.trackAccountDeleted).toHaveBeenCalledWith('user-1');
  });

  it.each([
    ['restored account', { deletedAt: null, deleteScheduledFor: null }],
    [
      'not-yet-due account',
      {
        deletedAt: new Date(),
        deleteScheduledFor: new Date(Date.now() + 60_000),
      },
    ],
  ])('skips a %s', async (_label, state) => {
    prisma.user.findUnique.mockResolvedValue(state);

    await service.permanentlyDeleteUser('user-1');

    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(analytics.trackAccountDeleted).not.toHaveBeenCalled();
  });

  it('skips cleanly when cancellation wins the conditional deletion race', async () => {
    prisma.user.findUnique.mockResolvedValue({
      deletedAt: new Date('2026-01-01'),
      deleteScheduledFor: new Date('2026-01-02'),
    });
    prisma.user.deleteMany.mockResolvedValue({ count: 0 });

    await service.permanentlyDeleteUser('user-1');

    expect(audit.log).not.toHaveBeenCalled();
    expect(analytics.trackAccountDeleted).not.toHaveBeenCalled();
  });

  it('preserves missing-user NotFound behavior', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.permanentlyDeleteUser('missing')).rejects.toThrow(
      'User not found',
    );
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('completes cancellation when scheduled job removal fails', async () => {
    const user = {
      id: 'user-1',
      deletedAt: new Date(),
      email: 'a@example.com',
      fname: 'A',
      lname: 'User',
      language: 'en',
      timezone: 'UTC',
    };
    prisma.user.findUnique.mockResolvedValue(user);
    prisma.user.update.mockResolvedValue({
      ...user,
      deletedAt: null,
      deleteScheduledFor: null,
    });
    queue.getJob.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.cancelAccountDeletion('user-1')).resolves.toEqual({
      message: 'Account deletion cancelled',
    });
    expect(prisma.user.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ACCOUNT_DELETION_CANCELLED' }),
    );
  });
});
