/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const prisma = {
    auditLog: {
      create: jest.fn(),
    },
  };

  const service = new AuditService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('stores null userId when no user is available', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'log-1' });

    await service.log({
      action: 'AUTH_VERIFY_FAILED',
      resource: 'auth',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: null,
          resourceId: null,
        }),
      }),
    );
  });
});
