# Refresh Token Implementation

## Overview

Access tokens are short-lived JWTs (`JWT_EXPIRES`, default `3600s`). Refresh
tokens are long-lived (`JWT_REFRESH_EXPIRES`, default `7d`), single-use, and
rotated on every refresh. The client holds a JWT signed with
`JWT_REFRESH_SECRET` that wraps a random 32-byte value; the database stores only
a SHA-256 hash of that value (`sha256:<hex>`).

Refreshing happens in exactly one place: `POST /auth/refresh`. The auth guard
never refreshes; it only verifies the access token.

## Data model (`prisma/schema.prisma`)

`RefreshToken`: `id`, `token` (hashed value, unique), `userId`, `expiresAt`
(copied from the signed JWT's `exp`), `createdAt`, `isRevoked`, `revokedAt`.

Rows written before hashing shipped hold the raw value. Lookups accept both
forms until those rows expire (one `JWT_REFRESH_EXPIRES` after the release),
after which the raw fallback in `storedRefreshTokenForms` can be removed.

## Endpoints

- `POST /auth/signin` – revokes the user's existing refresh tokens (one active
  session per user), bumps `authVersion`, returns `{ accessToken, refreshToken, user }`.
- `POST /auth/signup` – returns a first token pair.
- `POST /auth/refresh` – `{ refreshToken }` → `{ accessToken, refreshToken, user }`.
- `POST /auth/verify` – `{ token }` → the user, or **401** if the token is
  invalid. Still accepts `{ token, refreshToken }` and refreshes for app
  versions that predate the dedicated refresh flow; current clients never send it.
- `POST /auth/signout` – revokes all of the user's refresh tokens.

## Rotation, grace window and reuse detection (`src/auth/auth.service.ts`)

1. The presented refresh token is decoded and its unexpired row loaded (revoked
   or not).
2. **Active token:** inside a transaction that first claims the user row
   (`authVersion` guard against concurrent password resets), the old row is
   revoked (`isRevoked`, `revokedAt`) and a successor is created. The successor
   value is derived from the old one with an HMAC keyed by
   `JWT_REFRESH_SECRET`, so it can be re-derived later without storing raw
   values.
3. **Revoked token, within `REFRESH_TOKEN_REUSE_GRACE_MS` (60s) of rotation:**
   the same successor is re-issued. A lost or timed-out response, or two
   refreshes in flight at once, therefore never strands the client with a
   revoked token. If that successor was itself rotated within the window, the
   chain is followed to the live token. Re-issued tokens expire with their
   stored record, and a request that lost the race is judged by the recorded
   revocation time, so one stalled past the window counts as reuse.
4. **Rotated token replayed after the grace window:** treated as token theft —
   every refresh token for the user is revoked and `AUTH_REFRESH_REUSE_DETECTED`
   is audited.
5. **Token revoked without rotation** (sign-out, sign-in elsewhere, password
   reset): plain 401.

## Error contract

- **401** only for a genuinely bad session: invalid/expired/revoked token or
  credentials that changed mid-request. Clients treat it as "signed out".
- **5xx** for server faults (e.g. the database is unavailable). Clients keep the
  session and retry, so an outage never signs users out.

Routine 401s (expired tokens) are not reported to Sentry; unexpected failures are.

## Housekeeping

`RefreshTokenCleanupProcessor` (BullMQ, daily at 03:30 UTC) deletes rows whose
`expiresAt` has passed. Revoked-but-unexpired rows are kept for reuse detection.

## Client contract (`zenlot` app)

- `api/index.ts` `refreshSession()` is the only refresh path. Concurrent callers
  share one in-flight request; a 401 retry first reuses a token another request
  already refreshed.
- A refresh rejected with 401/403 clears the stored tokens and emits
  `onSessionExpired`, which `AuthProvider` turns into a local sign-out.
  Network/5xx failures keep the session.
- The rotated refresh token is persisted before the access token.
- Sockets read the current access token on every (re)connect and, after a
  server-side rejection, refresh (if needed) and reconnect, at most 3 times in
  a row.

## Environment variables

```env
JWT_SECRET=your_jwt_secret
JWT_EXPIRES=3600s
JWT_REFRESH_SECRET=your_refresh_secret
JWT_REFRESH_EXPIRES=7d
```

Any value `jsonwebtoken` accepts (e.g. `7d`, `1w`, `7 days`) works; the stored
expiry always matches the token's own `exp`.

## Manual testing

```bash
# Sign in
curl -X POST http://localhost:3000/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Refresh (re-sending the same refresh token within 60s still succeeds)
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your_refresh_token"}'

# Protected endpoint: only the access token header is read
curl http://localhost:3000/protected-endpoint -H "accessToken: your_access_token"
```

## Rollout notes

The hashed-storage change is not readable by instances running the previous
release. During a rolling deploy, a refresh served by an old instance for a
token issued by a new one fails with 401 and that user signs in again.
