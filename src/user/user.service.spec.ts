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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: UserGateway,
          useValue: { server: { emit: jest.fn() } },
        },
        {
          provide: AuditService,
          useValue: {},
        },
        {
          provide: EmailService,
          useValue: {},
        },
        {
          provide: AnalyticsService,
          useValue: {},
        },
        {
          provide: getQueueToken('deletion'),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('revokes existing refresh tokens after a password reset', async () => {
    const prisma = {
      user: { update: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };
    (service as any).prisma = prisma;

    await service.resetPassword('user-1', 'new-password');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isRevoked: false },
      data: { isRevoked: true },
    });
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
  });
});
