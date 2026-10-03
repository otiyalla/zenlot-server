import type { StringValue } from 'ms';

export const defaultExpiresIn: StringValue = '3600s';
export const defaultRefreshExpiresIn: StringValue = '7d';

export const resolveExpiration = (
  value: string | undefined,
  fallback: StringValue,
): StringValue => (value?.trim() ? (value as StringValue) : fallback);

// A refresh token revoked by rotation stays redeemable for this long, returning
// the same successor, so a lost/timed-out refresh response or two refreshes in
// flight at once don't strand the client with a revoked token. A replay after
// the window is treated as token reuse (theft) and revokes the user's sessions.
export const REFRESH_TOKEN_REUSE_GRACE_MS = 60_000;
