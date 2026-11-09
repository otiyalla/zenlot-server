import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';
import { UserRole } from '../auth/roles.constants';

export interface AdminActor {
  id: string;
  email: string;
}

export interface AdminRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminDeleteUserResult {
  id: string;
  email: string;
  /** Rows owned by the user that were removed with them (via FK cascades). */
  deleted: {
    journals: number;
    trades: number;
    refreshTokens: number;
    /** `feedback.userId` has no foreign key, so these are deleted explicitly. */
    feedback: number;
  };
  /** Other users' journals whose link to one of the deleted trades was cleared. */
  detachedJournals: number;
}

/** Fields safe to return from admin lookups (never the password hash). */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  fname: true,
  lname: true,
  role: true,
  createdAt: true,
  deletedAt: true,
  deleteScheduledFor: true,
} as const;

interface LockedUserRow {
  id: string;
  email: string;
  role: string;
  authVersion: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly socketSessions: SocketSessionRegistry,
    @InjectQueue('deletion') private readonly deletionQueue: Queue,
  ) {}

  findUsers(email?: string) {
    return this.prisma.user.findMany({
      where: email
        ? { email: { contains: email, mode: 'insensitive' } }
        : undefined,
      select: ADMIN_USER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Immediately and permanently deletes a user, skipping the 30-day grace
   * period that self-service deletion (`DELETE /user/:id`) uses.
   *
   * The target row is locked with `SELECT ... FOR UPDATE` and its email and
   * role are checked inside the same transaction, so a concurrent promotion or
   * email change cannot slip in between the checks and the delete. Every
   * user-owned table cascades from the user row, except `auditLog`, which keeps
   * its rows with `userId = NULL`, and `feedback`, whose `userId` has no foreign
   * key, so it is deleted explicitly. Another user's journal that links to one of
   * the target's trades is detached (`tradeId = NULL`) first, so the
   * `journal.tradeId` cascade does not remove it.
   */
  async hardDeleteUser(
    targetId: string,
    confirmEmail: string,
    actor: AdminActor,
    context: AdminRequestContext = {},
  ): Promise<AdminDeleteUserResult> {
    if (targetId === actor.id) {
      throw new BadRequestException(
        'Admins cannot delete their own account with this endpoint',
      );
    }

    const { result, authVersion } = await this.prisma.$transaction(
      async (tx) => {
        const [user] = await tx.$queryRaw<LockedUserRow[]>`
          SELECT "id", "email", "role", "authVersion"
          FROM "user" WHERE "id" = ${targetId} FOR UPDATE`;

        if (!user) {
          throw new NotFoundException('User not found');
        }

        if (
          user.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()
        ) {
          throw new BadRequestException(
            'confirmEmail does not match the email of the user being deleted',
          );
        }

        if (user.role === (UserRole.ADMIN as string)) {
          throw new ForbiddenException(
            'Admin accounts cannot be deleted with this endpoint; demote them first',
          );
        }

        const detachedJournals = await tx.journal.updateMany({
          where: { userId: { not: user.id }, trade: { userId: user.id } },
          data: { tradeId: null },
        });
        const [journals, trades, refreshTokens] = await Promise.all([
          tx.journal.count({ where: { userId: user.id } }),
          tx.trade.count({ where: { userId: user.id } }),
          tx.refreshToken.count({ where: { userId: user.id } }),
        ]);
        const feedback = await tx.feedback.deleteMany({
          where: { userId: user.id },
        });
        await tx.user.delete({ where: { id: user.id } });

        return {
          authVersion: user.authVersion,
          result: {
            id: user.id,
            email: user.email,
            deleted: {
              journals,
              trades,
              refreshTokens,
              feedback: feedback.count,
            },
            detachedJournals: detachedJournals.count,
          } satisfies AdminDeleteUserResult,
        };
      },
    );

    // The row is gone, so the guard already rejects the user's access tokens;
    // also drop any live sockets that authenticated before the delete.
    this.socketSessions.advanceAuthVersion(result.id, authVersion + 1);
    await this.cancelScheduledDeletion(result.id);

    await this.auditService.log({
      userId: actor.id,
      action: 'ADMIN_USER_HARD_DELETED',
      resource: 'user',
      resourceId: result.id,
      changes: {
        email: result.email,
        deleted: result.deleted,
        detachedJournals: result.detachedJournals,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    this.analytics.trackAccountDeleted(result.id);

    this.logger.warn(
      `Admin ${actor.id} <${actor.email}> hard-deleted user ${result.id} <${result.email}> ` +
        `(journals=${result.deleted.journals}, trades=${result.deleted.trades}, ` +
        `refreshTokens=${result.deleted.refreshTokens}, feedback=${result.deleted.feedback}, ` +
        `detachedJournals=${result.detachedJournals})`,
    );

    return result;
  }

  /**
   * A user who had requested self-service deletion still has a delayed
   * `permanent-deletion` job queued. Remove it so it does not fail later on a
   * user that no longer exists. Best effort: the delete has already happened.
   */
  private async cancelScheduledDeletion(userId: string): Promise<void> {
    try {
      const job = await this.deletionQueue.getJob(`deletion-${userId}`);
      await job?.remove();
    } catch (error) {
      this.logger.error(
        `Failed to remove scheduled deletion job for user ${userId}`,
        error,
      );
    }
  }
}
