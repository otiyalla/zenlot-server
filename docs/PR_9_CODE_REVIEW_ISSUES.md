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

### 2. Journal responses expose password hashes and verification secrets - Done

Journal queries use `include: { author: true }`, which serializes the complete user model. That model contains the password hash, email-verification token, verification-token expiry, deletion state, and other private account fields.

**Evidence:**

- [`src/journal/journal.service.ts`](../src/journal/journal.service.ts#L27)
- [`src/journal/journal.service.ts`](../src/journal/journal.service.ts#L73)
- [`prisma/schema.prisma`](../prisma/schema.prisma#L154)

### 3. Journal creation permits cross-tenant trade disclosure - Done

An authenticated user may supply any `tradeId` when creating a journal. Creation never verifies that the referenced trade belongs to the authenticated user.

A subsequent journal-list request includes the full related trade, allowing one user to retrieve another user's trade data when its UUID is known.

**Evidence:**

- [`src/journal/journal.controller.ts`](../src/journal/journal.controller.ts#L45)
- [`src/journal/journal.service.ts`](../src/journal/journal.service.ts#L14)
- [`src/journal/journal.service.ts`](../src/journal/journal.service.ts#L73)

### 4. The user WebSocket namespace leaks user data globally without authentication - Done

The user gateway performs no handshake authentication or per-user room assignment. User updates and deletion-state changes are broadcast globally to every connected socket.

Only the `password` property is removed. Email, profile details, deletion state, email-verification tokens, and token expiries can remain in the emitted row.

**Evidence:**

- [`src/user/user.gateway.ts`](../src/user/user.gateway.ts#L5)
- [`src/user/user.service.ts`](../src/user/user.service.ts#L291)
- [`src/user/user.service.ts`](../src/user/user.service.ts#L338)

### 5. The documented production database configuration cannot connect

Outside `NODE_ENV=local`, the service passes `DATABASE_URL` to Prisma as `accelerateUrl`. Prisma requires an Accelerate URL using `prisma://` or `prisma+postgres://` with an API key.

The Docker documentation explicitly instructs operators to supply a normal `postgresql://` URL. With that configuration, database initialization fails and the application starts with an unhealthy database connection.

**Evidence:**

- [`src/prisma/prisma.service.ts`](../src/prisma/prisma.service.ts#L22)
- [`README.md`](../README.md#L73)

### 6. Concurrent manual closes can settle PnL more than once - Done

The manual-close flow reads the trade and checks `status === "open"` before entering the transaction. The transaction then performs an unconditional `trade.update`.

Two concurrent close requests can both observe the open status, both close the trade, and both increment account balance and drawdown. The auto-close implementation correctly uses an atomic `updateMany` guarded by `status: "open"`, but the manual flows do not.

**Evidence:**

- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L267)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L305)
- [`src/trade/trade-auto-close.service.ts`](../src/trade/trade-auto-close.service.ts#L231)

### 7. A cancelled account-deletion job can permanently delete the restored account - Done

Cancellation clears `deletedAt` and `deleteScheduledFor` before attempting to remove the BullMQ job. Job-removal errors are caught and suppressed.

The deletion worker and `permanentlyDeleteUser` do not re-check whether deletion is still scheduled or whether the grace period has elapsed. A stale or racing job can therefore permanently delete an account after cancellation.

**Evidence:**

- [`src/user/user.service.ts`](../src/user/user.service.ts#L413)
- [`src/user/user.service.ts`](../src/user/user.service.ts#L421)
- [`src/jobs/deletion.processor.ts`](../src/jobs/deletion.processor.ts#L33)
- [`src/user/user.service.ts`](../src/user/user.service.ts#L464)

### 8. Risk sizing accepts stops and targets on the wrong side of the entry - Done

Request validation checks only that entry, stop, and target prices are positive. Risk and reward calculations then use absolute distances instead of validating direction-specific geometry.

A buy trade can have its stop above entry and target below entry, pass governance, and auto-close immediately as `reached_tp` while recording a loss. The inverse is possible for sell trades.

**Evidence:**

- [`src/risk/dto/calculate-risk.dto.ts`](../src/risk/dto/calculate-risk.dto.ts#L17)
- [`src/risk/engine/calculations.ts`](../src/risk/engine/calculations.ts#L94)
- [`src/risk/engine/calculations.ts`](../src/risk/engine/calculations.ts#L127)
- [`src/trade/trade-auto-close.service.ts`](../src/trade/trade-auto-close.service.ts#L171)

### 9. The legacy trade-creation endpoint bypasses risk governance

`POST /trade` accepts client-provided lot, exchange rate, risk, reward, account currency, and status without invoking the risk engine or governance checks.

Open trades created through this route have no server-calculated capital exposure. The portfolio service treats null exposure as zero, allowing the route to bypass portfolio and correlated-exposure limits.

**Evidence:**

- [`src/trade/trade.controller.ts`](../src/trade/trade.controller.ts#L49)
- [`src/trade/trade.service.ts`](../src/trade/trade.service.ts#L39)
- [`src/risk/portfolio.service.ts`](../src/risk/portfolio.service.ts#L30)

### 10. Linking one checklist attaches every pending evaluation to that trade - Done

Checklists and evaluations have no direct relationship. When one checklist is linked, the service updates every unlinked evaluation belonging to that user.

If multiple checklists are pending, their evaluations are all attributed to the first logged trade. Later trades then lose the correct evaluation or are recorded as having skipped their checklist.

**Evidence:**

- [`src/evaluation/evaluation.service.ts`](../src/evaluation/evaluation.service.ts#L53)
- [`src/evaluation/evaluation.service.ts`](../src/evaluation/evaluation.service.ts#L171)
- [`src/evaluation/evaluation.service.ts`](../src/evaluation/evaluation.service.ts#L187)
- [`prisma/schema.prisma`](../prisma/schema.prisma#L319)

### 11. Behavioral reports exclude the trades that are actually graded - In progress

Behavioral-report assembly queries only trades with `status: "closed"`.

The real settlement paths write `closed_in_profit`, `closed_in_loss`, `reached_tp`, or `reached_sl`. Normal graded trades therefore never enter behavioral reports or evaluation summary statistics.

**Evidence:**

- [`src/evaluation/behavioral-report.service.ts`](../src/evaluation/behavioral-report.service.ts#L157)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L300)
- [`src/trade/trade-auto-close.service.ts`](../src/trade/trade-auto-close.service.ts#L171)

### 12. Stop adjustments leave governance exposure stale - To Do

The dedicated stop-adjustment route changes only `stopLoss.value` and appends an adjustment record. It preserves the old pip distance and does not recalculate risk, reward, R:R, capital exposure, or exposure percentage.

Widening a stop consequently understates portfolio risk and may allow later trades through governance incorrectly.

**Evidence:**

- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L368)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L402)
- [`src/risk/portfolio.service.ts`](../src/risk/portfolio.service.ts#L37)

### 13. Closing while editing trade geometry settles against old values - To Do

`updateForUser` passes the old trade together with the new update payload to `settleManualClose`.

PnL and R-multiple are calculated using the old entry, lot, execution, symbol, and stop. The transaction then persists the new values, leaving financial settlement inconsistent with the stored trade.

**Evidence:**

- [`src/trade/trade.service.ts`](../src/trade/trade.service.ts#L270)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L431)

## Medium-Severity Findings

### 14. Session revocation is fail-open

Refresh-token revocation catches and suppresses every database error. Sign-in, sign-out, and token rotation can therefore report success while old refresh tokens remain valid.

Password changes and password resets also do not revoke existing refresh tokens.

**Evidence:**

- [`src/auth/auth.service.ts`](../src/auth/auth.service.ts#L428)
- [`src/auth/auth.service.ts`](../src/auth/auth.service.ts#L450)
- [`src/user/user.service.ts`](../src/user/user.service.ts#L180)

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

### 17. Feedback content is inserted into administrative HTML email unsanitized

Public `subject` and `message` values are interpolated directly into HTML. An attacker can inject arbitrary markup, links, or tracking images into emails viewed by staff.

**Evidence:**

- [`src/email/email.service.ts`](../src/email/email.service.ts#L68)

### 18. Feedback always reports successful email delivery

The service captures the actual `emailSent` result but hard-codes `emailSent: true` in its response. Callers and monitoring cannot distinguish successful delivery from transport failure.

**Evidence:**

- [`src/feedback/feedback.service.ts`](../src/feedback/feedback.service.ts#L91)
- [`src/feedback/feedback.service.ts`](../src/feedback/feedback.service.ts#L107)

### 19. User updates return an empty response

The service fetches the updated user and broadcasts it but never returns the updated row to the controller. A successful `PUT /user/:id` therefore produces an empty response body.

**Evidence:**

- [`src/user/user.service.ts`](../src/user/user.service.ts#L291)

### 20. Price-feed WebSocket header authentication is broken

Node lowercases incoming header names, but the gateway looks up `accessToken`. Its Bearer regex also contains `\\s` inside a regex literal, matching a literal backslash rather than whitespace.

Standard custom-header and `Authorization: Bearer ...` authentication paths fail; only `handshake.auth.accessToken` works.

**Evidence:**

- [`src/price-feed/price-feed.gateway.ts`](../src/price-feed/price-feed.gateway.ts#L57)

### 21. Journal reminders are marked delivered before dispatch

The reminder date is persisted before notification dispatch. The notification layer then catches and suppresses delivery errors.

A provider failure, missing push token, or quiet-hours suppression prevents any retry for the rest of that local day.

**Evidence:**

- [`src/notifications/journal-reminder.service.ts`](../src/notifications/journal-reminder.service.ts#L36)
- [`src/notifications/notifications.service.ts`](../src/notifications/notifications.service.ts#L135)

### 22. FX rates can remain stale indefinitely

When refreshing an expired rate fails, the service returns the old value and renews its cache timestamp.

Repeated provider failures can keep using an arbitrarily old conversion rate for risk sizing and realized PnL without a maximum acceptable age or degraded-data indicator.

**Evidence:**

- [`src/quote/quote.service.ts`](../src/quote/quote.service.ts#L251)

### 23. Trade creation and governance logging are not atomic

The trade is committed first, followed by a separate governance-log write.

If governance logging fails, the request returns an error after persisting the trade. Retrying can create duplicate trades with missing governance history.

**Evidence:**

- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L137)
- [`src/risk/trade-log.service.ts`](../src/risk/trade-log.service.ts#L168)

### 24. The chasing-entry detector cannot receive its required trigger type

Behavioral-report assembly sets `entryQuality.planned` to an empty string even though the detector requires the declared checklist trigger type.

Objective-trigger trades are therefore never selected by `detectChasingEntries`.

**Evidence:**

- [`src/evaluation/behavioral-report.service.ts`](../src/evaluation/behavioral-report.service.ts#L252)
- [`src/evaluation/engine/behavioral.ts`](../src/evaluation/engine/behavioral.ts#L415)

### 25. CI validates modified files and does not run the full test suite

The `lint` script uses `--fix`, so CI silently rewrites the checkout before type-checking, building, and testing. A non-mutating lint run currently reports 19 errors.

CI then derives a Jest path pattern from changed source paths instead of running the complete suite, which can miss regressions in downstream modules.

**Evidence:**

- [`package.json`](../package.json#L24)
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L43)
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml#L52)

## Low-Severity Finding

### 26. Date-range end values exclude almost the entire ending day

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

