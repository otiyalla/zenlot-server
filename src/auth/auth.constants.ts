import type { StringValue } from 'ms';

export const defaultExpiresIn: StringValue = '3600s';
export const defaultRefreshExpiresIn: StringValue = '7d';

export const resolveExpiration = (
  value: string | undefined,
  fallback: StringValue,
): StringValue => (value?.trim() ? (value as StringValue) : fallback);
