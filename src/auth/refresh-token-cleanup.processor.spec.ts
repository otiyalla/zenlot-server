import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  PURGE_EXPIRED_REFRESH_TOKENS_JOB,
  RefreshTokenCleanupProcessor,
} from './refresh-token-cleanup.processor';

describe('RefreshTokenCleanupProcessor', () => {
  const setup = () => {
    const prisma = {
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const processor = new RefreshTokenCleanupProcessor(
      prisma as unknown as PrismaService,
      queue as unknown as Queue,
    );
    return { prisma, queue, processor };
  };

  it('schedules a single daily repeatable purge', async () => {
    const { queue, processor } = setup();

    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      PURGE_EXPIRED_REFRESH_TOKENS_JOB,
      {},
      {
        // A fixed jobId keeps restarts from stacking duplicate schedules.
        jobId: PURGE_EXPIRED_REFRESH_TOKENS_JOB,
        repeat: { pattern: '30 3 * * *', tz: 'UTC' },
      },
    );
  });

  it('deletes only refresh tokens past their expiry', async () => {
    const { prisma, processor } = setup();
    const before = Date.now();

    await processor.process();

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
    const [{ where }] = prisma.refreshToken.deleteMany.mock.calls[0] as [
      { where: { expiresAt: { lt: Date } } },
    ];
    expect(Object.keys(where)).toEqual(['expiresAt']);
    expect(where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
