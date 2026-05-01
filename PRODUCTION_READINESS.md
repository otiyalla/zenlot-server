# Production readiness (zenlot-server)

This list covers what is still needed to consider the backend production ready. Excluded from this list: containerization (Dockerfile), E2E tests, CI, and frontend API URL.

---

## Done

- CORS driven by `CORS_ORIGIN` (HTTP + WebSocket gateways)
- Health check at `GET /health` with database probe (returns 503 if DB down)
- Feedback rate limit backed by Redis, configurable via `FEEDBACK_RATE_LIMIT_PER_USER_PER_DAY`
- Global validation pipe, Helmet, rate limiting, Sentry, auth (JWT + refresh)

---

## Remaining (to be production ready)

### 1. Sentry configuration for production

**File:** `src/instrument.ts`

- **sendDefaultPii:** Set from env (e.g. `SENTRY_PII`). Use `false` in production; avoid sending PII by default.
- **tracesSampleRate / profilesSampleRate:** Set from env (e.g. `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_PROFILE_SAMPLE_RATE`). In production use lower values (e.g. 0.1) or disable profiling to reduce cost and overhead.

**Action:** Read these from `process.env` and default to production-safe values when `NODE_ENV === 'production'`.

---

### 2. Global HTTP rate limit from config

**File:** `src/main.ts`

Rate limit is hardcoded (`max: 100`, `timeWindow: '1 minute'`). ENV_VARIABLES.md documents `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` but they are not used.

**Action:** Read `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS` (or a human-friendly window) from ConfigService and pass them into `@fastify/rate-limit`. Document defaults in ENV_VARIABLES.md.

---

### 3. Graceful shutdown

Ensure the app closes cleanly on SIGTERM/SIGINT (e.g. in production) so that:

- Prisma disconnects
- BullMQ workers drain and Redis connection closes
- HTTP server stops accepting new requests

**Action:** Call `app.close()` in a signal handler (or use `enableShutdownHooks` if not already wired). Ensure PrismaModule/PrismaService and BullMQ are closed in order.

---

### 4. Environment variable and doc alignment

**File:** `ENV_VARIABLES.md` (repo root)

There are mismatches between the doc, `.env.example`, and the code (e.g. JWT/refresh names, Redis TLS, Sentry vars, DB env-specific vars). A dedicated **“Environment variable alignment”** section was added to ENV_VARIABLES.md.

**Action:** Apply the changes suggested in that section so the doc and `.env.example` match what the code actually reads.

---

### 5. Secrets in production

Doc recommends using a secrets manager (e.g. AWS Secrets Manager, Vault) in production instead of plain `.env` files.

**Action:** Document how production secrets are loaded (env vars injected by platform, or a small bootstrap that fetches from a secrets manager and sets `process.env` before the app starts). No code change strictly required if the platform injects env.

---

### 6. (Optional) WebSocket authentication

Quote and price-feed gateways accept unauthenticated connections. If those endpoints should be restricted:

**Action:** Add the same JWT (or token) validation on WebSocket handshake; reject connections without a valid token.

---

### 7. (Optional) Reverse proxy and logging

- **Reverse proxy:** Document running behind Nginx/Caddy (or host proxy) for TLS and optional rate limiting at the edge.
- **Structured logging:** If you add `LOG_LEVEL`, wire it to your logger (e.g. Nest Logger or Pino) so log level is configurable without code changes.

---

## Quick checklist


| Item                                                    | Status                     |
| ------------------------------------------------------- | -------------------------- |
| Sentry: PII + sample rates from env, prod-safe defaults | Todo                       |
| HTTP rate limit from RATE_LIMIT_* env                   | Todo                       |
| Graceful shutdown (SIGTERM/SIGINT)                      | Todo                       |
| Env doc and .env.example aligned with code              | Section added; apply fixes |
| Production secrets approach documented                  | Todo                       |
| WebSocket auth (if required)                            | Optional                   |
| Reverse proxy + LOG_LEVEL (optional)                    | Optional                   |
