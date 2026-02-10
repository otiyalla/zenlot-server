/**
 * CORS origin list from CORS_ORIGIN env (comma-separated).
 * Used by HTTP server (main.ts) and WebSocket gateways.
 * Defaults allow local Expo and production app.
 */
const DEFAULT_ORIGINS = ['http://localhost:8081', 'https://zenlot.net'];

export function getCorsOrigins(originEnv?: string): string[] {
  const raw = originEnv ?? process.env.CORS_ORIGIN;
  if (raw?.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return DEFAULT_ORIGINS;
}
