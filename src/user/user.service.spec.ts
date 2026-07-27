import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGateway } from './user.gateway';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { AnalyticsService } from '../analytics/analytics.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: any;
  let audit: any;
  let analytics: any;
  let email: any;
  let queue: any;

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
    };
    email = {
      sendAccountDeletionCancelledNotice: jest.fn(),
    };
    queue = { getJob: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: UserGateway,
          useValue: { emitUserUpdate: jest.fn() },
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
