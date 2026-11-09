import { SetMetadata } from '@nestjs/common';
import { UserRole } from './roles.constants';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or every route in a controller) to users whose `role`
 * matches one of the given roles. Must be combined with `RolesGuard`, which
 * relies on the global `AuthGuard` having already populated `request.user`.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
