import { ForbiddenException } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController authorization', () => {
  const userService = {
    create: jest.fn(),
    changePassword: jest.fn(),
    findAll: jest.fn(),
    getDeletionStatus: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    initiateAccountDeletion: jest.fn(),
    cancelAccountDeletion: jest.fn(),
    remove: jest.fn(),
  } as unknown as UserService;

  const controller = new UserController(userService);

  beforeEach(() => jest.clearAllMocks());

  it('forces current user id in changePassword payload', async () => {
    const dto: any = {
      userId: 'attacker-id',
      currentPassword: 'currpass123',
      newPassword: 'newpass123',
    };
    const req = {
      user: { id: 'owner-1', role: 'trader' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    };

    await controller.changePassword(dto, req);

    expect(dto.userId).toBe('owner-1');
    expect(userService.changePassword).toHaveBeenCalledWith(
      dto,
      '127.0.0.1',
      'jest',
    );
  });

  it('rejects listing all users for non-admin', () => {
    const req = { user: { id: 'owner-1', role: 'trader' } };

    expect(() => controller.findAll(req)).toThrow(ForbiddenException);
    expect(userService.findAll).not.toHaveBeenCalled();
  });

  it('allows an admin to list all users', () => {
    const req = { user: { id: 'admin-1', role: 'admin' } };

    controller.findAll(req);

    expect(userService.findAll).toHaveBeenCalled();
  });

  it('rejects access to another users profile for non-admin', () => {
    const req = { user: { id: 'owner-1', role: 'trader' } };

    expect(() => controller.findOne('owner-2', req)).toThrow(
      ForbiddenException,
    );
  });

  it('allows an admin to access another users profile', () => {
    const req = { user: { id: 'admin-1', role: 'admin' } };

    controller.findOne('owner-2', req);

    expect(userService.findOne).toHaveBeenCalledWith('owner-2');
  });

  it('rejects updates to another user for non-admin', () => {
    const req = {
      user: { id: 'owner-1', role: 'trader' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    };

    expect(() => controller.update('owner-2', {} as any, req)).toThrow(
      ForbiddenException,
    );
    expect(userService.update).not.toHaveBeenCalled();
  });

  it('rejects deleting another user for non-admin', () => {
    const req = {
      user: { id: 'owner-1', role: 'trader' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
    };

    expect(() => controller.remove('owner-2', req)).toThrow(ForbiddenException);
    expect(userService.remove).not.toHaveBeenCalled();
  });
});
