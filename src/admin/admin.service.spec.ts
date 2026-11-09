import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

type LockedUser = { id: number; email: string; role: string };

describe('AdminService', () => {
  let service: AdminService;
  let warn: jest.SpyInstance;
  let calls: string[];
  let lockedRows: LockedUser[];
  let tx: {
    $queryRaw: jest.Mock;
    journal: { updateMany: jest.Mock; deleteMany: jest.Mock };
    trade: { deleteMany: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    user: { delete: jest.Mock };
  };
  let prisma: {
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const admin = { id: 1, email: 'admin@zenlot.com' };
  const target: LockedUser = {
    id: 42,
    email: 'E2E+Signup@zenlot.com',
    role: 'trader',
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
        deleteMany: jest.fn(record('journal.deleteMany', { count: 3 })),
      },
      trade: { deleteMany: jest.fn(record('trade.deleteMany', { count: 2 })) },
      refreshToken: {
        deleteMany: jest.fn(record('refreshToken.deleteMany', { count: 1 })),
      },
      user: { delete: jest.fn(record('user.delete', target)) },
    };
    prisma = {
      user: { findMany: jest.fn() },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AdminService);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  describe('hardDeleteUser', () => {
    it('locks the target, then deletes all dependent rows before the user, in one transaction', async () => {
      const result = await service.hardDeleteUser(
        42,
        'e2e+signup@zenlot.com',
        admin,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([
        'lock',
        'journal.detach',
        'journal.deleteMany',
        'trade.deleteMany',
        'refreshToken.deleteMany',
        'user.delete',
      ]);
      const [sql] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(sql.join('?')).toMatch(/FOR UPDATE/);
      expect(tx.journal.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(tx.trade.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 42 } });
      expect(result).toEqual({
        id: 42,
        email: 'E2E+Signup@zenlot.com',
        deleted: { journals: 3, trades: 2, refreshTokens: 1 },
        detachedJournals: 1,
      });
    });

    it("detaches other users' journals from the target's trades instead of deleting them", async () => {
      await service.hardDeleteUser(42, target.email, admin);

      expect(tx.journal.updateMany).toHaveBeenCalledWith({
        where: { userId: { not: 42 }, trade: { userId: 42 } },
        data: { tradeId: null },
      });
    });

    it('writes an audit log entry naming the admin and the deleted user', async () => {
      await service.hardDeleteUser(42, target.email, admin);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Admin 1 <admin@zenlot.com> hard-deleted user 42',
        ),
      );
    });

    it('throws NotFound when the user does not exist', async () => {
      lockedRows = [];

      await expect(
        service.hardDeleteUser(42, target.email, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(calls).toEqual(['lock']);
    });

    it('refuses when confirmEmail does not match the locked row', async () => {
      await expect(
        service.hardDeleteUser(42, 'someone-else@zenlot.com', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(calls).toEqual(['lock']);
      expect(warn).not.toHaveBeenCalled();
    });

    it('refuses to let an admin delete their own account', async () => {
      await expect(
        service.hardDeleteUser(admin.id, admin.email, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a user who is an admin at lock time', async () => {
      lockedRows = [{ ...target, role: 'admin' }];

      await expect(
        service.hardDeleteUser(42, target.email, admin),
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
        expect.objectContaining({ id: true, email: true }),
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
