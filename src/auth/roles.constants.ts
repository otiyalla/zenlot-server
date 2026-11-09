export enum UserRole {
  TRADER = 'trader',
  ADMIN = 'admin',
}

/** Role assigned to every self-registered account. */
export const DEFAULT_USER_ROLE = UserRole.TRADER;
