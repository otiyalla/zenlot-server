import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../auth/roles.constants';

export interface AdminActor {
  id: number;
  email: string;
}

export interface AdminDeleteUserResult {
  id: number;
  email: string;
  deleted: {
    journals: number;
    trades: number;
    refreshTokens: number;
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
} as const;

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

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
   * Immediately and permanently deletes a user and every row that belongs to
   * them (journals, trades, refresh tokens) in a single transaction.
   *
   * The target row is locked with `SELECT ... FOR UPDATE` and its email and
   * role are checked inside the same transaction, so a concurrent promotion or
   * email change cannot slip in between the checks and the delete.
   *
   * `trade.userId` is `ON DELETE RESTRICT`, so the user row cannot be removed
   * until their trades are gone; dependent rows are removed explicitly. Another
   * user's journal that links to one of the target's trades is detached
   * (`tradeId = NULL`) rather than lost to the `journal.tradeId` cascade.
   */
  async hardDeleteUser(
    targetId: number,
    confirmEmail: string,
    actor: AdminActor,
  ): Promise<AdminDeleteUserResult> {
    if (targetId === actor.id) {
      throw new BadRequestException(
        'Admins cannot delete their own account with this endpoint',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [user] = await tx.$queryRaw<
        { id: number; email: string; role: string }[]
      >`SELECT "id", "email", "role" FROM "user" WHERE "id" = ${targetId} FOR UPDATE`;

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
      const journals = await tx.journal.deleteMany({
        where: { userId: user.id },
      });
      const trades = await tx.trade.deleteMany({ where: { userId: user.id } });
      const refreshTokens = await tx.refreshToken.deleteMany({
        where: { userId: user.id },
      });
      await tx.user.delete({ where: { id: user.id } });

      return {
        id: user.id,
        email: user.email,
        deleted: {
          journals: journals.count,
          trades: trades.count,
          refreshTokens: refreshTokens.count,
        },
        detachedJournals: detachedJournals.count,
      } satisfies AdminDeleteUserResult;
    });

    this.logger.warn(
      `Admin ${actor.id} <${actor.email}> hard-deleted user ${result.id} <${result.email}> ` +
        `(journals=${result.deleted.journals}, trades=${result.deleted.trades}, ` +
        `refreshTokens=${result.deleted.refreshTokens}, ` +
        `detachedJournals=${result.detachedJournals})`,
    );

    return result;
  }
}
