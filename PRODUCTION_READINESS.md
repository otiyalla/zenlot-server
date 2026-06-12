# Production Readiness — zenlot-server

A living checklist for operating the Zenlot API (NestJS + Fastify, Prisma/PostgreSQL,
Redis/BullMQ, Socket.IO) in production. Status reflects the codebase as of the last review.

Legend: ✅ done · 🟡 partial / verify · ⬜ todo · ➖ optional / N-A

---

## 1. Security

| Item | Status | Notes |
| --- | --- | --- |
| Authentication (JWT access + rotating refresh tokens) | ✅ | `auth` module; refresh tokens persisted & revoked on signin/signout |
| Authorization enforced on every protected route | ✅ | Global guard + per-resource owner/admin checks (`assertSelfOrAdmin`, `assertAdmin`) |
| No PII / secrets in API responses | ✅ | `stripPassword` removes password **and** email-verification token/expiry |
| Input validation + DTO whitelisting | ✅ | Global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) |
| Security headers | ✅ | `@fastify/helmet` with a restrictive CSP |
| CORS from config | ✅ | `CORS_ORIGIN` drives HTTP + WebSocket origins |
| Rate limiting (HTTP) from config | ✅ | `@fastify/rate-limit`, `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW_MS` |
| Per-feature rate limiting | ✅ | Feedback endpoint limited via Redis (`FEEDBACK_RATE_LIMIT_PER_USER_PER_DAY`) |
| WebSocket authentication | ✅ | Quote + price-feed gateways verify JWT on handshake, disconnect on failure |
| Secrets never committed | ✅ | `.env*` gitignored; history clean; only `.env.example` tracked |
| Secrets sourced from a manager in prod | 🟡 | Document/inject via platform env or AWS Secrets Manager/Vault (no plaintext `.env` on hosts) |
| Dependency vulnerability scanning | ⬜ | Add `yarn npm audit` / Dependabot / Snyk in CI |
| Password hashing | ✅ | bcrypt (bcryptjs), salted |

## 2. Observability

| Item | Status | Notes |
| --- | --- | --- |
| Error tracking (Sentry) | ✅ | `instrument.ts`; PII + trace/profile sample rates from env, prod-safe defaults |
| Structured request logging | ✅ | Fastify logger enabled |
| Configurable log level | 🟡 | Wire `LOG_LEVEL` → logger (Pino/Nest Logger) so verbosity is env-driven |
| Health check with dependency probe | ✅ | `GET /health` returns 503 when the DB is down |
| Readiness vs. liveness split | 🟡 | Consider `/health/live` (process up) vs `/health/ready` (DB + Redis reachable) for orchestrators |
| Product analytics | ✅ | Mixpanel (`analytics` module), gated by token |
| Metrics (RED/USE) endpoint | ➖ | Optional: expose Prometheus metrics if you run a metrics stack |

## 3. Reliability & operations

| Item | Status | Notes |
| --- | --- | --- |
| Graceful shutdown | ✅ | `enableShutdownHooks()` + Prisma `onModuleDestroy` `$disconnect`; BullMQ workers drain on `app.close()` |
| Container image | ✅ | Production `Dockerfile`; `RUN_DB_MIGRATIONS=true` runs `prisma migrate deploy` on boot |
| Reverse proxy / TLS termination | ✅ | Behind Nginx; `localhost:3000` → `https://api.zenlot.net` (see DEPLOYMENT_NGINX… doc) |
| `trustProxy` enabled | ✅ | Set in Fastify adapter so client IPs/rate-limit keys are correct behind the proxy |
| Background jobs (BullMQ) | ✅ | `price-feed`, `deletion` queues with retry/backoff & removeOnComplete/Fail |
| Job idempotency / dead-letter handling | 🟡 | Verify retried jobs are idempotent; monitor failed queue |
| Horizontal scalability | 🟡 | Stateless HTTP ✅; confirm Socket.IO uses a Redis adapter before running >1 instance |

## 4. Data

| Item | Status | Notes |
| --- | --- | --- |
| Migrations are versioned & forward-only | ✅ | Prisma migrations; `migrate deploy` in prod (never `db push`) |
| Migration strategy documented | ✅ | `MIGRATION_*.md`, `create_migration.sh`, env-scoped `db:migrate:*` scripts |
| Connection pooling | ✅ | Prisma adapter (local) / Accelerate (managed) |
| Backups & PITR | ⬜ | Confirm managed Postgres backups + tested restore runbook |
| Soft-delete + scheduled hard-delete (GDPR) | ✅ | Account deletion: 30-day grace, status endpoint, cancel, `deletion` queue |
| Audit logging | ✅ | `audit` module records auth/account/security events |

## 5. CI/CD & quality

| Item | Status | Notes |
| --- | --- | --- |
| Continuous Integration | ✅ | `.github/workflows/ci.yml`: install → prisma generate → lint → typecheck → build → test |
| Unit / integration tests | ✅ | Jest; controllers, services, guards, authz, gateways covered |
| Lint clean (0 errors) | ✅ | `any`-propagation rules are warnings (tracked debt); real-defect rules are errors |
| Type safety | ✅ | `tsc --noEmit` clean in CI |
| Test coverage gate | ⬜ | Add a `--coverage` threshold once a baseline is agreed |
| E2E / contract tests against a real DB | 🟡 | Spin up Postgres + Redis service containers in CI for a true e2e job |
| Automated deploy pipeline | 🟡 | Document/automate build → migrate → release (currently manual `build:with:package`) |

## 6. Configuration & docs

| Item | Status | Notes |
| --- | --- | --- |
| 12-factor config (all settings via env) | ✅ | `ConfigModule`, env-specific files, DB URL mapping by `NODE_ENV` |
| Env var reference doc | ⬜ | Add `ENV_VARIABLES.md` listing every var the code reads, with defaults |
| `.env.example` matches code | 🟡 | Keep in sync with the reference doc above |
| Swagger gated in prod | ✅ | Enabled by default off-prod; `SWAGGER_ENABLED` to force on |
| Runbooks (deploy, rollback, incident) | 🟡 | Nginx/EACCES doc exists; add rollback + on-call runbook |

---

## Top remaining items (highest leverage first)

1. **`ENV_VARIABLES.md`** — single source of truth for env vars + defaults; reconcile with `.env.example`.
2. **Dependency scanning in CI** — Dependabot/Snyk or `yarn npm audit`.
3. **E2E job with Postgres + Redis service containers** — exercise real migrations + queues.
4. **Backups + tested restore runbook** for production Postgres.
5. **Socket.IO Redis adapter** before scaling beyond one instance.
6. **`LOG_LEVEL`** wired to the logger; **liveness/readiness** split for orchestrators.
7. **Secrets manager** in production (no plaintext `.env` on hosts) + **automated deploy** pipeline.
