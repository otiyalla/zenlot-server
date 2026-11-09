import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { SAFE_USER_SELECT, UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserGateway } from './user.gateway';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPasswordDto } from './dto/user-password.dto';

describe('UserService', () => {
  let service: UserService;
  let emit: jest.Mock;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    journal: { deleteMany: jest.Mock };
    trade: { deleteMany: jest.Mock };
    refreshToken: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    emit = jest.fn();
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 7, email: 'e2e@zenlot.com' }),
        update: jest.fn().mockResolvedValue({ id: 1 }),
        delete: jest.fn().mockReturnValue('user.delete'),
      },
      journal: { deleteMany: jest.fn().mockReturnValue('journal.deleteMany') },
      trade: { deleteMany: jest.fn().mockReturnValue('trade.deleteMany') },
      refreshToken: {
        deleteMany: jest.fn().mockReturnValue('refreshToken.deleteMany'),
      },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ count: 3 }, { count: 2 }, { count: 1 }, {}]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserGateway, useValue: { server: { emit } } },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('SAFE_USER_SELECT', () => {
    it('never selects the password hash', () => {
      expect(SAFE_USER_SELECT).not.toHaveProperty('password');
      expect(SAFE_USER_SELECT).toMatchObject({ id: true, email: true });
    });
  });

  describe('create', () => {
    const dto: Partial<CreateUserDto> = {
      fname: 'E2E',
      lname: 'User',
      email: 'e2e@zenlot.com',
      language: 'en',
      role: 'admin',
      accountCurrency: 'USD',
      password: 'password123',
    };

    it('ignores a client-supplied role so signup cannot create admins', async () => {
      await service.create(dto as CreateUserDto);

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'trader' }),
        select: SAFE_USER_SELECT,
      });
    });

    it('returns the created user without the password hash', async () => {
      const result = await service.create(dto as CreateUserDto);

      expect(result).toEqual({ id: 7, email: 'e2e@zenlot.com' });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ select: SAFE_USER_SELECT }),
      );
    });
  });

  describe('findOne', () => {
    it('selects only safe fields', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 5 });

      await expect(service.findOne(5)).resolves.toEqual({ id: 5 });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 5 },
        select: SAFE_USER_SELECT,
      });
    });

    it('throws 404 when the user does not exist', async () => {
      await expect(service.findOne(5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('ignores a client-supplied role so users cannot escalate', async () => {
      const dto: Partial<UpdateUserDto> = { role: 'admin', fname: 'New' };
      await service.update(1, dto as UpdateUserDto);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.not.objectContaining({ role: expect.anything() }),
        select: SAFE_USER_SELECT,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({ fname: 'New' }),
        select: SAFE_USER_SELECT,
      });
    });

    it('returns and broadcasts the safe projection of the user', async () => {
      prisma.user.update.mockResolvedValue({ id: 1, fname: 'New' });

      const result = await service.update(1, {
        fname: 'New',
      } as UpdateUserDto);

      expect(result).toEqual({ id: 1, fname: 'New' });
      expect(emit).toHaveBeenCalledWith('updated-user', {
        id: 1,
        fname: 'New',
      });
    });
  });

  describe('changePassword', () => {
    const dto = {
      userId: 999,
      currentPassword: 'old-password',
      newPassword: 'new-password',
    } as UserPasswordDto;

    it('acts on the id passed by the caller, not dto.userId', async () => {
      const hash = await bcrypt.hash('old-password', 4);
      prisma.user.findUnique.mockResolvedValue({ id: 2, password: hash });
      prisma.user.update.mockResolvedValue({ id: 2 });

      await expect(service.changePassword(2, dto)).resolves.toBe(true);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 2 } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { password: expect.any(String) },
        select: { id: true },
      });
    });

    it('does not change the password when the current one is wrong', async () => {
      const hash = await bcrypt.hash('something-else', 4);
      prisma.user.findUnique.mockResolvedValue({ id: 2, password: hash });

      await expect(service.changePassword(2, dto)).resolves.toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the user and their journals, trades and refresh tokens in one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 2 });

      const result = await service.remove(2);

      expect(prisma.journal.deleteMany).toHaveBeenCalledWith({
        where: { userId: 2 },
      });
      expect(prisma.trade.deleteMany).toHaveBeenCalledWith({
        where: { userId: 2 },
      });
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 2 },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 2 } });
      // Trades must go before the user row (trade.userId is ON DELETE RESTRICT).
      expect(prisma.$transaction).toHaveBeenCalledWith([
        'journal.deleteMany',
        'trade.deleteMany',
        'refreshToken.deleteMany',
        'user.delete',
      ]);
      expect(result).toEqual({
        id: 2,
        deleted: { journals: 3, trades: 2, refreshTokens: 1 },
      });
    });

    it('throws 404 and deletes nothing when the user does not exist', async () => {
      await expect(service.remove(2)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
