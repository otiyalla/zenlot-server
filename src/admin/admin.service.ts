import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../auth/roles.constants';
import { deleteUserWithData } from '../user/user-deletion';

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
   * them (journals, trades, refresh tokens) in a single transaction. See
   * `deleteUserWithData`.
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

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw new BadRequestException(
        'confirmEmail does not match the email of the user being deleted',
      );
    }

    if (user.role === (UserRole.ADMIN as string)) {
      throw new ForbiddenException(
        'Admin accounts cannot be deleted with this endpoint; demote them first',
      );
    }

    const deleted = await deleteUserWithData(this.prisma, user.id);

    const result: AdminDeleteUserResult = {
      id: user.id,
      email: user.email,
      deleted,
    };

    this.logger.warn(
      `Admin ${actor.id} <${actor.email}> hard-deleted user ${result.id} <${result.email}> ` +
        `(journals=${result.deleted.journals}, trades=${result.deleted.trades}, ` +
        `refreshTokens=${result.deleted.refreshTokens})`,
    );

    return result;
  }
}
