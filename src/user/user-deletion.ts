import { PrismaService } from '../prisma/prisma.service';

export interface DeletedUserData {
  journals: number;
  trades: number;
  refreshTokens: number;
}

/**
 * Permanently deletes a user and every row that belongs to them (journals,
 * trades, refresh tokens) in a single transaction.
 *
 * `trade.userId` is `ON DELETE RESTRICT`, so the user row cannot be removed
 * until their trades are gone; all dependent rows are removed explicitly, in
 * dependency order, so the operation does not rely on database cascade rules.
 *
 * Shared by the self-service `DELETE /user/:id` route and the admin
 * hard-delete endpoint.
 */
export async function deleteUserWithData(
  prisma: PrismaService,
  userId: number,
): Promise<DeletedUserData> {
  const [journals, trades, refreshTokens] = await prisma.$transaction([
    prisma.journal.deleteMany({ where: { userId } }),
    prisma.trade.deleteMany({ where: { userId } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return {
    journals: journals.count,
    trades: trades.count,
    refreshTokens: refreshTokens.count,
  };
}
