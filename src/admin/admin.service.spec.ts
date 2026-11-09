import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';

type LockedUser = {
  id: string;
  email: string;
  role: string;
  authVersion: number;
};

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-000000000042';

describe('AdminService', () => {
  let service: AdminService;
  let warn: jest.SpyInstance;
  let calls: string[];
  let lockedRows: LockedUser[];
  let tx: {
    $queryRaw: jest.Mock;
    journal: { updateMany: jest.Mock; count: jest.Mock };
    trade: { count: jest.Mock };
    refreshToken: { count: jest.Mock };
    feedback: { deleteMany: jest.Mock };
    user: { delete: jest.Mock };
  };
  let prisma: { user: { findMany: jest.Mock }; $transaction: jest.Mock };
  let audit: { log: jest.Mock };
  let analytics: { trackAccountDeleted: jest.Mock };
  let sockets: { advanceAuthVersion: jest.Mock };
  let scheduledJob: { remove: jest.Mock } | undefined;
  let queue: { getJob: jest.Mock };

  const admin = { id: ADMIN_ID, email: 'admin@zenlot.com' };
  const target: LockedUser = {
    id: TARGET_ID,
    email: 'E2E+Signup@zenlot.com',
    role: 'trader',
    authVersion: 3,
  };

  const record =
    (name: string, value: unknown) =>
    (..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    };

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    calls = [];
    lockedRows = [target];
    tx = {
      $queryRaw: jest.fn(() => {
        calls.push('lock');
        return Promise.resolve(lockedRows);
      }),
      journal: {
        updateMany: jest.fn(record('journal.detach', { count: 1 })),
        count: jest.fn(record('journal.count', 3)),
      },
      trade: { count: jest.fn(record('trade.count', 2)) },
      refreshToken: { count: jest.fn(record('refreshToken.count', 1)) },
      feedback: {
        deleteMany: jest.fn(record('feedback.deleteMany', { count: 2 })),
      },
      user: { delete: jest.fn(record('user.delete', target)) },
    };
    prisma = {
      user: { findMany: jest.fn() },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    analytics = { trackAccountDeleted: jest.fn() };
    sockets = { advanceAuthVersion: jest.fn().mockReturnValue(0) };
    scheduledJob = undefined;
    queue = { getJob: jest.fn(() => Promise.resolve(scheduledJob)) };

    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: AnalyticsService, useValue: analytics },
        { provide: SocketSessionRegistry, useValue: sockets },
        { provide: getQueueToken('deletion'), useValue: queue },
      ],
    }).compile();

    service = module.get(AdminService);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('hardDeleteUser', () => {
    it('locks the target, detaches foreign journals, then deletes the user in one transaction', async () => {
      const result = await service.hardDeleteUser(
        TARGET_ID,
        'e2e+signup@zenlot.com',
        admin,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls[0]).toBe('lock');
      expect(calls[1]).toBe('journal.detach');
      expect(calls[calls.length - 1]).toBe('user.delete');
      const [sql] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(sql.join('?')).toMatch(/FOR UPDATE/);
      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: TARGET_ID } });
      expect(result).toEqual({
        id: TARGET_ID,
        email: 'E2E+Signup@zenlot.com',
        deleted: { journals: 3, trades: 2, refreshTokens: 1, feedback: 2 },
        detachedJournals: 1,
      });
    });

    it("detaches other users' journals from the target's trades instead of deleting them", async () => {
      await service.hardDeleteUser(TARGET_ID, target.email, admin);

      expect(tx.journal.updateMany).toHaveBeenCalledWith({
        where: { userId: { not: TARGET_ID }, trade: { userId: TARGET_ID } },
        data: { tradeId: null },
      });
    });

    it("deletes the user's feedback before the user row, since feedback.userId has no foreign key", async () => {
      await service.hardDeleteUser(TARGET_ID, target.email, admin);

      expect(tx.feedback.deleteMany).toHaveBeenCalledWith({
        where: { userId: TARGET_ID },
      });
      expect(calls.indexOf('feedback.deleteMany')).toBeLessThan(
        calls.indexOf('user.delete'),
      );
    });

    it('drops live sockets by advancing past the locked auth version', async () => {
      await service.hardDeleteUser(TARGET_ID, target.email, admin);

      expect(sockets.advanceAuthVersion).toHaveBeenCalledWith(TARGET_ID, 4);
    });

    it('removes a pending scheduled-deletion job for the user', async () => {
      scheduledJob = { remove: jest.fn().mockResolvedValue(undefined) };

      await service.hardDeleteUser(TARGET_ID, target.email, admin);

      expect(queue.getJob).toHaveBeenCalledWith(`deletion-${TARGET_ID}`);
      expect(scheduledJob.remove).toHaveBeenCalled();
    });

    it('still succeeds if removing the scheduled job fails', async () => {
      queue.getJob.mockRejectedValue(new Error('redis down'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(
        service.hardDeleteUser(TARGET_ID, target.email, admin),
      ).resolves.toEqual(expect.objectContaining({ id: TARGET_ID }));
    });

    it('records an audit log entry attributed to the admin, plus analytics and a warn log', async () => {
      await service.hardDeleteUser(TARGET_ID, target.email, admin, {
        ipAddress: '10.0.0.1',
        userAgent: 'curl',
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ADMIN_ID,
          action: 'ADMIN_USER_HARD_DELETED',
          resource: 'user',
          resourceId: TARGET_ID,
          ipAddress: '10.0.0.1',
          userAgent: 'curl',
        }),
      );
      expect(analytics.trackAccountDeleted).toHaveBeenCalledWith(TARGET_ID);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          `Admin ${ADMIN_ID} <admin@zenlot.com> hard-deleted user ${TARGET_ID}`,
        ),
      );
    });

    it('throws NotFound when the user does not exist', async () => {
      lockedRows = [];

      await expect(
        service.hardDeleteUser(TARGET_ID, target.email, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(calls).toEqual(['lock']);
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('refuses when confirmEmail does not match the locked row', async () => {
      await expect(
        service.hardDeleteUser(TARGET_ID, 'someone-else@zenlot.com', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(calls).toEqual(['lock']);
      expect(sockets.advanceAuthVersion).not.toHaveBeenCalled();
    });

    it('refuses to let an admin delete their own account', async () => {
      await expect(
        service.hardDeleteUser(ADMIN_ID, admin.email, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a user who is an admin at lock time', async () => {
      lockedRows = [{ ...target, role: 'admin' }];

      await expect(
        service.hardDeleteUser(TARGET_ID, target.email, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls).toEqual(['lock']);
    });
  });

  describe('findUsers', () => {
    it('filters by a case-insensitive email substring and never selects the password', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findUsers('e2e');

      const [args] = prisma.user.findMany.mock.calls[0] as [
        { where: unknown; select: Record<string, boolean> },
      ];
      expect(args.where).toEqual({
        email: { contains: 'e2e', mode: 'insensitive' },
      });
      expect(args.select.password).toBeUndefined();
      expect(args.select).toEqual(
        expect.objectContaining({ id: true, email: true, deletedAt: true }),
      );
    });

    it('returns all users when no filter is given', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findUsers();

      const [args] = prisma.user.findMany.mock.calls[0] as [{ where: unknown }];
      expect(args.where).toBeUndefined();
    });
  });
});
