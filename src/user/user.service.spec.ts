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

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
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
