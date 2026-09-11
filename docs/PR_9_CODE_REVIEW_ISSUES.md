# PR #9 Code Review Issues

- **Pull request:** [#9 — Dev](https://github.com/otiyalla/zenlot-server/pull/9)
- **Review range:** `origin/initial-branch...dev`
- **Recommendation:** Request changes
- **Confirmed findings:** 26 total — 13 high, 12 medium, 1 low
- **Implementation status:** No fixes were implemented as part of this review

## Executive Summary

The pull request builds, type-checks, and passes the current automated test suite. However, the review identified merge-blocking defects involving anonymous password resets, tenant isolation, secret exposure, account deletion, financial settlement, risk governance, behavioral reporting, and production database configuration.

The passing tests do not currently cover several important security, concurrency, cross-tenant, deployment, and cross-module integration paths.

## High-Severity Findings

### 1. Anonymous password reset can lock users out

Both password-reset endpoints are public and require only an email address. They immediately overwrite the password with a `Math.random()` temporary password and email it, without requiring a reset token or proof of email ownership.

An attacker can repeatedly invalidate a victim's credentials. The endpoints also reveal whether an email is registered, send passwords through email, and leave the legitimate user locked out if email delivery fails after the database update.

**Evidence:**

- [`src/auth/auth.controller.ts`](../src/auth/auth.controller.ts#L103)
- [`src/auth/auth.service.ts`](../src/auth/auth.service.ts#L354)

### 5. The documented production database configuration cannot connect

Outside `NODE_ENV=local`, the service passes `DATABASE_URL` to Prisma as `accelerateUrl`. Prisma requires an Accelerate URL using `prisma://` or `prisma+postgres://` with an API key.

The Docker documentation explicitly instructs operators to supply a normal `postgresql://` URL. With that configuration, database initialization fails and the application starts with an unhealthy database connection.

**Evidence:**

- [`src/prisma/prisma.service.ts`](../src/prisma/prisma.service.ts#L22)
- [`README.md`](../README.md#L73)

### 9. The legacy trade-creation endpoint bypasses risk governance - Done

`POST /trade` accepts client-provided lot, exchange rate, risk, reward, account currency, and status without invoking the risk engine or governance checks.

Open trades created through this route have no server-calculated capital exposure. The portfolio service treats null exposure as zero, allowing the route to bypass portfolio and correlated-exposure limits.

**Evidence:**

- [`src/trade/trade.controller.ts`](../src/trade/trade.controller.ts#L49)
- [`src/trade/trade.service.ts`](../src/trade/trade.service.ts#L39)
- [`src/risk/portfolio.service.ts`](../src/risk/portfolio.service.ts#L30)


### 12. Stop adjustments leave governance exposure stale - To Do

The dedicated stop-adjustment route changes only `stopLoss.value` and appends an adjustment record. It preserves the old pip distance and does not recalculate risk, reward, R:R, capital exposure, or exposure percentage.

Widening a stop consequently understates portfolio risk and may allow later trades through governance incorrectly.

**Evidence:**

- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L368)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L402)
- [`src/risk/portfolio.service.ts`](../src/risk/portfolio.service.ts#L37)

### 15. The environment template does not match required runtime configuration

The template defines `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, and `FOREX_API_KEY`.

Runtime requires `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_PROVIDER`, and `FMP_API_KEY`. Following the checked-in template causes email-module bootstrap to fail and leaves FMP functionality unconfigured.

**Evidence:**

- [`.env.example`](../.env.example#L13)
- [`.env.example`](../.env.example#L19)
- [`src/email/email.module.ts`](../src/email/email.module.ts#L25)
- [`src/config/config.constant.ts`](../src/config/config.constant.ts#L1)

### 16. Public feedback accepts a caller-supplied user identity

Anonymous callers can provide any user UUID and have feedback and analytics attributed to that user.

The feedback table has no user foreign key, while audit logging does. Invalid or spoofed associations can therefore persist while the audit write fails silently.

**Evidence:**

- [`src/feedback/feedback.controller.ts`](../src/feedback/feedback.controller.ts#L30)
- [`src/feedback/dto/create-feedback.dto.ts`](../src/feedback/dto/create-feedback.dto.ts#L30)
- [`src/feedback/feedback.service.ts`](../src/feedback/feedback.service.ts#L52)


### 25. CI validates modified files and does not run the full test suite

The `lint` script uses `--fix`, so CI silently rewrites the checkout before type-checking, building, and testing. A non-mutating lint run currently reports 19 errors.

CI then derives a Jest path pattern from changed source paths instead of running the complete suite, which can miss regressions in downstream modules.

**Evidence:**

- [`package.json`](../package.json#L24)
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L43)
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L52)

## Low-Severity Finding

### 26. Date-range end values exclude almost the entire ending day - Done

A date-only value such as `2026-07-27` becomes midnight at the start of that date and is used with `lte`.

This affects several trade and journal searches, excluding entries created after `00:00:00` on the requested ending date.

**Evidence:**

- [`src/trade/trade.service.ts`](../src/trade/trade.service.ts#L107)
- [`src/trade/trade.service.ts`](../src/trade/trade.service.ts#L204)
- [`src/journal/journal.service.ts`](../src/journal/journal.service.ts#L130)

## Validation Results

Validation was performed from a clean temporary checkout of the PR head:

| Check | Result |
| --- | --- |
| Prisma client generation | Passed |
| Prisma schema validation | Passed |
| TypeScript type-check | Passed |
| Production build | Passed |
| Jest | 81 suites and 574 tests passed |
| Non-mutating ESLint | 19 errors and 63 warnings |
| GitHub Actions run | Passed |

The successful build and test results do not invalidate the findings above. The current suite does not exercise several of the affected concurrency, authorization, serialization, deployment, and cross-module integration paths.

## Recommended Disposition

PR #9 should remain unmerged until the high-severity findings are addressed and regression tests are added for:

- Password-reset authorization and session revocation
- Journal tenant ownership and safe user serialization
- Authenticated, room-scoped user WebSocket delivery
- Atomic trade closing and idempotent PnL settlement
- Account-deletion cancellation races
- Directionally valid trade geometry
- Risk-governed trade creation and stop adjustment
- Checklist-to-evaluation identity
- Closed-trade behavioral-report status handling
- Both PostgreSQL adapter and Prisma Accelerate deployment modes

