# AGENTS.md — Zenlot server

Guidance for AI agents (Claude Code, Codex, Symphony-dispatched runs) and contributors.
Keep it current when architecture or conventions change. `CLAUDE.md` imports this file.

> Companion client: `Zenlot` (Expo / React Native). It talks to this API over REST + Socket.IO.
> A change to a request/response shape, auth behaviour, or socket event is a **cross-repo
> change** — say so in the PR and link the client work.

## What this is

NestJS API for Zenlot, a forex trading journal with a risk engine: trades, journal entries,
risk profiles / drawdown / governance, pre-trade evaluation and post-trade grading, push
notifications, and a live price feed.

## Stack

- **NestJS 11 on Fastify** (`@nestjs/platform-fastify`; `main.ts` builds a `FastifyAdapter`).
  Helmet, rate-limit, CORS and a global `ValidationPipe` (`whitelist`,
  `forbidNonWhitelisted`, `transform`) are registered in `src/main.ts`.
- **Prisma 7 + PostgreSQL** (`prisma/schema.prisma`, `prisma/migrations/`, `@prisma/adapter-pg`).
- **BullMQ + Redis** for jobs (processors under `src/jobs`, `src/risk`, `src/evaluation`,
  `src/notifications`, `src/trade`, `src/auth`).
- **Socket.IO** price feed (`src/price-feed`).
- **Sentry** (`src/instrument.ts` is a CommonJS-`require` file that must initialise Sentry
  before other imports are evaluated — keep it that way), **Mixpanel**,
  **nodemailer**, **expo-server-sdk** (push), **Anthropic / OpenAI** for AI coaching
  (`src/risk/coaching`, `src/evaluation/coaching`). Coaching is non-blocking: with no
  API key it is silently skipped.
- Yarn 4 (`packageManager` in `package.json`, binary in `.yarn/releases`), Node 22.
- Jest + ts-jest; unit specs are colocated as `*.spec.ts` next to the source.

## Layout

```
src/
  auth/            JWT access + rotating refresh tokens, AuthGuard (global), socket session registry
  user/ journal/ trade/ risk/ evaluation/ notifications/ feedback/ quote/ candle/ price-feed/
  audit/ email/ jobs/ prisma/ config/ constants/ custom_decorator/ utils/
  main.ts          bootstrap (Fastify, helmet, rate limit, Swagger)
  app.module.ts    module wiring, ConfigModule env-file selection, BullMQ root config
prisma/            schema.prisma, migrations/, seed.ts, prisma.config.ts
scripts/           migrate-prod.ts, migrate-status.ts (env-aware migration runners)
test/              e2e specs + mocks (expo-server-sdk is mocked: it is ESM)
docs/              design / ops notes — see "Docs" below for which are current
```

## Commands

```bash
yarn install --immutable        # Yarn 4; CI should use the same
yarn db:generate                # prisma generate (needed before tsc/build/test)
yarn lint:ci                    # eslint WITHOUT --fix + warning ratchet — exactly what CI runs
yarn lint:check                 # eslint WITHOUT --fix, no ratchet
yarn lint                       # eslint --fix (mutates files)
yarn typecheck                  # tsc --noEmit
yarn test                       # all jest specs (unit + e2e-spec pattern)
yarn test --testPathPattern=<path>   # one area
yarn build                      # prisma generate + nest build
yarn start:local                # NODE_ENV=local, watch mode
docker compose up -d            # local Postgres 16 + Redis (docker-compose.yml)
yarn db:migrate                 # prisma migrate dev (creates a migration; local only)
```

Before opening a PR run, at minimum: `yarn lint:ci && yarn typecheck && yarn test`.
CI runs those plus `yarn build`. `yarn lint` rewrites files; use `lint:ci` for a verdict.
`lint:ci` fails if warnings exceed the ratchet in `package.json` (`--max-warnings`) — lower
that number when you clean warnings up, never raise it.

## Invariants — do not break these

### Auth
- The access token travels in an **`accessToken` request header** (not `Authorization:
  Bearer`). See `AuthGuard.extractAccessToken`.
- `AuthGuard` is registered globally as `APP_GUARD` in `auth.module.ts`. Routes are
  protected by default; `@Public()` opts out. On a public route a valid token still
  attaches `req.user` (optional auth); `/auth/*` public routes handle their own tokens.
- Per-request verification uses `authService.verifyToken`, **not** `verify()`
  (`verify()` is the `/auth/verify` endpoint logic and writes audit/analytics rows).
- Refresh tokens are **single-use and rotated**. A revoked token stays redeemable for
  `REFRESH_TOKEN_REUSE_GRACE_MS` (60 s) and returns the same successor; a replay after the
  window is treated as theft and revokes the user's sessions. Do not weaken this without
  reading `docs/REFRESH_TOKEN_IMPLEMENTATION.md` and `auth.service.rotation.spec.ts`.
- Sign-out removes the user's push tokens.

### Tenant isolation
- **Never trust a `userId` from the request body, query or params.** Resolve the owner from
  `req.user` (`AuthenticatedRequest`). `trade.controller.authz.spec.ts` shows the pattern:
  a body `userId: 'attacker-id'` must be ignored. Service methods that fetch or mutate a
  user-owned row take the caller's id (see `findOneForUser`, `updateForUser`,
  `removeForUser`) and must scope the Prisma `where` by it.
- A new endpoint that touches user data needs an authorization test in the same style.

### Validation
- Every request body / query / param goes through a DTO with `class-validator`
  decorators. The global pipe uses `forbidNonWhitelisted`, so an undecorated field is
  rejected, not ignored. Add DTO cases to `src/validation-boundaries.spec.ts` for new
  boundaries.

### Risk engine
- Lot sizing and governance run server-side (`src/risk/engine`). Legacy trade creation is
  routed through the same sizing + governance path — client-supplied `lot` is not
  authoritative. Keep `engine/*` pure (no Nest/Prisma imports) so `*.spec.ts` stay fast.

### Database
- **Schema changes need a migration** in `prisma/migrations/<timestamp>_<name>/`. Never edit
  an applied migration. Create with `yarn db:migrate` locally (or `./create_migration.sh`,
  which calls `sudo chown` — skip it in sandboxes).
- `prisma migrate deploy` runs in production only when `RUN_DB_MIGRATIONS=true`
  (`docker/entrypoint.sh`). Migrations must be backward-compatible with the previously
  deployed server build where practical (the old build runs until the new one is up).
- `scripts/migrate-prod.ts` / `migrate-status.ts` touch real environments. **Agents must
  not run `db:migrate:prod`, `db:migrate:dev`, `db:reset`, or `db:docker:rebuild`.**
- `migration_add_rr_risk_reward.sql` at the repo root is a stray, unreferenced file — do not
  treat it as the migration mechanism.

### Jobs
- Processors must be idempotent (BullMQ retries). Scheduled jobs use leases / dedupe keys
  (see `journal-reminder-lease.ts`); copy that approach rather than inventing a new one.

## Domain rules

Zenlot is a **trading journal, not an execution platform**. These have been corrected in
past sessions; do not re-litigate them.

- **Nothing hard-blocks a trade.** A trade that breaks a governance rule is never refused:
  the user acknowledges the rule and proceeds (`LogTradeDto`, `overrideMode`
  `simple` / `detailed`). `blocked` is a verdict to surface and record, not to enforce.
- **Informational checks never gate.** Checks flagged `informational` (e.g. the per-trade
  capital-exposure check) are ignored by the overall verdict (`risk/engine/governance.ts`).
  Treat the pre-trade check as advice.
- **Server-owned fields.** `isAutoClosed` is set only by the server (`trade.service.ts`
  forces it on create and strips it on update; `trade-auto-close.service.ts` sets it).
  Never accept it from a client payload.
- **Terminology:** `execution` is `buy` / `sell`, not long / short.
- **Locales:** `fr` (and `es`) use a decimal comma — `1,5` means `1.5`. Parse and format
  numbers per locale; do not assume `.`.

## Working agreements for agents

- **Diagnose before implementing** when a person asks a question or reports a bug
  interactively: report findings and a proposed approach, and implement after a go-ahead.
  In an unattended run (e.g. Symphony), the assigned Linear issue *is* the go-ahead — but if
  the issue is ambiguous, record the question in the issue and stop instead of guessing.
- **Don't claim "done" on unverified work.** State exactly which checks you ran and their
  results in the PR's Validation section. If you could not run something (no simulator, no
  database, no network), say so — never imply it passed.
- **Clean up what you start.** Kill any dev server, simulator, or background process you
  launched before you finish.
- **Never touch production.** No production URLs, databases, or real user credentials. Use
  local or staging backends and the secrets the environment provides; never put credentials
  in a file, a commit, or a PR description.
- **Quote paths with parentheses** in shell commands (`"app/(protected)/..."`) — they break
  unquoted in zsh.
- **Stay in scope.** One issue → one focused PR. Note unrelated problems in the PR or as a
  follow-up issue instead of fixing them in the same change.

## Conventions

- Controllers: `@ApiTags`, `@ApiSecurity('access-token')`, `@ApiOperation` /
  `@ApiResponse` on each handler. Swagger is served at `/api/docs` outside production
  (or when `SWAGGER_ENABLED=true`).
- Colocate `*.spec.ts` with the file. Mock Prisma / Redis / Expo in unit specs; unit specs
  must not need a live DB. `expo-server-sdk` is mapped to `test/mocks/expo-server-sdk.ts`.
- TypeScript is lenient (`noImplicitAny: false`) and ESLint downgrades the `no-unsafe-*`
  family to warnings. **Do not add new warnings** — type new code properly even though the
  config allows `any`.
- Prettier (`.prettierrc`) is enforced through ESLint.
- Env: `.env.example` is the contract. Add every new variable there with a comment. Env
  files are selected by `NODE_ENV` in `app.module.ts` (`.env.local`, `.env.dev`,
  `.env.prod`, then `.env`). Never commit real values.
- User-facing strings (emails, push copy, coaching) are localized — see
  `src/utils/locale.util.ts`, `notification.copy.ts`, `risk/engine/i18n.ts`. Supported
  languages must stay in sync with the client (`en`, `fr`, `es`).

## Pull requests

- Branch from `dev`; target `dev`. Use the PR template at `.github/pull_request_template.md`.
- Link the Linear issue (its identifier, e.g. `<TEAM>-123`) or, for legacy work, the Jira
  key (`SCRUM-123`) in the title or body.
- Describe the change for a reviewer who has not seen the conversation: what, why,
  validation actually run (paste results), risks, and **client impact / deploy ordering**.
- Never force-push a branch someone else has pushed to. Do not merge your own PR.
- Review rules for Claude are in `CLAUDE.md`.

## Docs

Current references: `PUSH_NOTIFICATIONS.md`, `REFRESH_TOKEN_IMPLEMENTATION.md`,
`PRODUCTION_READINESS.md`, `PRD_MULTI_BROKER_SHARED_RISK.md`,
`TRD_NX_MICROSERVICES_MULTI_BROKER.md`. Historical, do **not** treat as current state:
`PR_9_CODE_REVIEW_ISSUES.md` (a point-in-time review), `MIGRATION_FIX.md`,
`MIGRATION_UUID_STRINGS.md`, `PHASE1_RISK_ENGINE_PLAN.md`.

## Gotchas

- `yarn lint` auto-fixes. Running it in a clean tree can still dirty it.
- `.yarn/install-state.gz` changes on every install; it is generated and must not be committed.
- `jest.config.js` `testRegex` also matches `*.e2e-spec.ts`, so `yarn test` runs everything
  under `test/`. `session-revocation-concurrency.e2e-spec.ts` only runs when
  `SESSION_REVOCATION_TEST_DATABASE_URL` is set (it is skipped otherwise, including in CI);
  keep every other spec runnable without a live database.
- Production host mapping is Nginx → `localhost:3000`, public at `https://api.zenlot.net`.
  The Dockerfile `EXPOSE`s 3000; local dev defaults differ (`PORT=4000` in `.env.example`).
