import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AdminService', () => {
  let service: AdminService;
  let warn: jest.SpyInstance;
  let prisma: {
    user: { findUnique: jest.Mock; findMany: jest.Mock; delete: jest.Mock };
    journal: { deleteMany: jest.Mock };
    trade: { deleteMany: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const admin = { id: 1, email: 'admin@zenlot.com' };
  const target = { id: 42, email: 'E2E+Signup@zenlot.com', role: 'trader' };

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn().mockReturnValue('user.delete'),
      },
      journal: { deleteMany: jest.fn().mockReturnValue('journal.deleteMany') },
      trade: { deleteMany: jest.fn().mockReturnValue('trade.deleteMany') },
      refreshToken: {
        deleteMany: jest.fn().mockReturnValue('refreshToken.deleteMany'),
      },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ count: 3 }, { count: 2 }, { count: 1 }, target]),
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
    it('deletes the user and all dependent rows in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(target);

      const result = await service.hardDeleteUser(
        42,
        'e2e+signup@zenlot.com',
        admin,
      );

      expect(prisma.journal.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(prisma.trade.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 42 },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 42 } });
      // Dependents must be removed before the user row (trade FK is RESTRICT).
      expect(prisma.$transaction).toHaveBeenCalledWith([
        'journal.deleteMany',
        'trade.deleteMany',
        'refreshToken.deleteMany',
        'user.delete',
      ]);
      expect(result).toEqual({
        id: 42,
        email: 'E2E+Signup@zenlot.com',
        deleted: { journals: 3, trades: 2, refreshTokens: 1 },
      });
    });

    it('writes an audit log entry naming the admin and the deleted user', async () => {
      prisma.user.findUnique.mockResolvedValue(target);
      await service.hardDeleteUser(42, target.email, admin);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Admin 1 <admin@zenlot.com> hard-deleted user 42',
        ),
      );
    });

    it('throws NotFound when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.hardDeleteUser(42, target.email, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses when confirmEmail does not match the target user', async () => {
      prisma.user.findUnique.mockResolvedValue(target);

      await expect(
        service.hardDeleteUser(42, 'someone-else@zenlot.com', admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to let an admin delete their own account', async () => {
      await expect(
        service.hardDeleteUser(admin.id, admin.email, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete another admin', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 7,
        email: 'other-admin@zenlot.com',
        role: 'admin',
      });

      await expect(
        service.hardDeleteUser(7, 'other-admin@zenlot.com', admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
