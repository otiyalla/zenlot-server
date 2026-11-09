/**
 * Trim wrapping quotes / trailing semicolons that sneak in from .env files.
 * Mirrors the per-provider sanitization used by the quote module so candle
 * providers treat keys identically.
 */
export function sanitizeApiKey(rawApiKey?: string): string | undefined {
  if (!rawApiKey) {
    return undefined;
  }

  const sanitized = rawApiKey
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/;+\s*$/g, '')
    .trim();

  return sanitized || undefined;
}
