import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from './roles.constants';

export interface RequestUser {
  id: number;
  role?: string;
}

export function isAdmin(user: { role?: string } | undefined | null): boolean {
  return user?.role === (UserRole.ADMIN as string);
}

/**
 * Allows the request only when the authenticated user is acting on their own
 * account or is an admin. Throws 401 when there is no authenticated user and
 * 403 otherwise.
 */
export function assertSelfOrAdmin(
  user: RequestUser | undefined | null,
  targetUserId: number,
): void {
  if (!user || user.id === undefined || user.id === null) {
    throw new UnauthorizedException('Authentication required');
  }
  if (Number(user.id) === targetUserId || isAdmin(user)) {
    return;
  }
  throw new ForbiddenException('You can only access your own account');
}
