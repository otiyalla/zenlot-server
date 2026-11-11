import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const REFRESH_TOKEN_CLEANUP_QUEUE = 'auth-refresh-token-cleanup';
export const PURGE_EXPIRED_REFRESH_TOKENS_JOB = 'purge-expired-refresh-tokens';

/**
 * Every refresh rotates the token and leaves the old row behind (revoked rows
 * are kept until they expire, for reuse detection), so the table otherwise
 * grows without bound. Daily, delete rows past their expiry: their JWTs have
 * expired too, so no request can ever match them again. Expired password-reset
 * links are purged in the same pass: they can never be redeemed either.
 */
@Processor(REFRESH_TOKEN_CLEANUP_QUEUE)
export class RefreshTokenCleanupProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(RefreshTokenCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(REFRESH_TOKEN_CLEANUP_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      PURGE_EXPIRED_REFRESH_TOKENS_JOB,
      {},
      {
        jobId: PURGE_EXPIRED_REFRESH_TOKENS_JOB,
        repeat: { pattern: '30 3 * * *', tz: 'UTC' },
      },
    );
  }

  async process(): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    this.logger.log(`Purged ${count} expired refresh tokens`);
    const { count: resetCount } =
      await this.prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: now } },
      });
    this.logger.log(`Purged ${resetCount} expired password reset links`);
  }
}
