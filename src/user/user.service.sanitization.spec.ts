import { UserService } from './user.service';

describe('UserService sanitization', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const gateway = { server: { emit: jest.fn() } };
  const auditService = { log: jest.fn() };
  const emailService = {
    sendWelcomeEmail: jest.fn(),
    sendAccountDeletionNotice: jest.fn(),
    sendAccountDeletionCancelledNotice: jest.fn(),
  };
  const analytics = {
    identifyUser: jest.fn(),
    trackAccountCreated: jest.fn(),
    trackPasswordChanged: jest.fn(),
    trackUserUpdated: jest.fn(),
    trackEmailVerified: jest.fn(),
    trackEmailVerificationRequested: jest.fn(),
    trackAccountDeletionInitiated: jest.fn(),
    trackAccountDeletionCancelled: jest.fn(),
    trackAccountDeleted: jest.fn(),
  };
  const deletionQueue = { add: jest.fn(), getJob: jest.fn() };

  const service = new UserService(
    prisma as any,
    gateway as any,
    auditService as any,
    emailService as any,
    analytics as any,
    deletionQueue as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('removes password from findAll response', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'u1@mail.com', password: 'hash-1', deletedAt: null },
      { id: 'u2', email: 'u2@mail.com', password: 'hash-2', deletedAt: null },
    ]);

    const users = await service.findAll();

    expect(users).toEqual([
      { id: 'u1', email: 'u1@mail.com', deletedAt: null },
      { id: 'u2', email: 'u2@mail.com', deletedAt: null },
    ]);
  });

  it('removes password from findOne response', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'u1@mail.com',
      password: 'hash-1',
      deletedAt: null,
    });

    const user = await service.findOne('u1');

    expect(user).toEqual({
      id: 'u1',
      email: 'u1@mail.com',
      deletedAt: null,
    });
  });

  it('ignores privileged fields in update payload', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      fname: 'Alice',
      role: 'trader',
      emailVerified: false,
      password: 'hash-1',
    });

    await service.update('u1', {
      fname: 'Alice',
      role: 'admin',
      emailVerified: true,
      deleteScheduledFor: new Date('2026-01-01'),
    } as any);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          fname: 'Alice',
        }),
      }),
    );

    const callArg = prisma.user.update.mock.calls[0][0].data;
    expect(callArg.role).toBeUndefined();
    expect(callArg.emailVerified).toBeUndefined();
    expect(callArg.deleteScheduledFor).toBeUndefined();
  });

  it('does not allow callers to choose a privileged role on create', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.update.mockReset();
    (prisma.user as any).create = jest.fn().mockResolvedValue({
      id: 'u1',
      fname: 'Alice',
      lname: 'Trader',
      email: 'alice@example.com',
      role: 'trader',
      password: 'hash-1',
    });

    await service.create({
      fname: 'Alice',
      lname: 'Trader',
      email: 'alice@example.com',
      language: 'en',
      accountCurrency: 'USD',
      password: 'password123',
      role: 'admin',
      rules: { forex: { takeProfit: [], stopLoss: [] } },
    } as any);

    expect((prisma.user as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'trader',
        }),
      }),
    );
  });
});
