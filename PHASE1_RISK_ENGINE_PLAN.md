# Phase 1 — Risk Engine: Implementation Plan

> Status: **Phase 1 complete (backend + frontend bridge).** Backend: PR1 engine + Risk Profile + `/risk/calculate` (PR4) + logging/close/drawdown/cron/i18n (PR5) + AI coaching (PR6) — 45 suites / 201 tests. Frontend bridge shipped — 81 suites / 203 tests. Both tsc + lint clean.

## Frontend bridge (zenlot app)
- **Contract layer:** `types/risk.ts` (calc view, governance, portfolio, drawdown, coaching), `validations/risk.ts` (`calculateRiskValidation`), `api/risk.ts` (`calculate`, `logTrade`, `closeTrade`, `getPortfolio`, `getDrawdown`), plus a `patch` method added to the shared `api` client (for close).
- **`useRiskCalculation` hook:** debounced POST /risk/calculate as the trader edits symbol/entry/stop/target/lot; returns `{ result, loading, error }`.
- **`RiskSummary` molecule:** live governance badge (approved/warning/blocked), recommended-vs-chosen lot, capital exposure, R:R, non-informational check messages (server-localized), and the correlated-exposure disclaimer. Embedded additively in `TradeEntryForm`.
- **Governed logging:** `TradeProvider.logRiskTrade` → POST /risk/trades (server re-sizes + governs; passes the user's chosen `lot` as the override). `HomePage` confirm uses it; 422 (blocked) / 503 surface the server message.
- **Coaching:** `TradeProvider` listens for `coaching_ready` on the existing quote socket and shows the (server-localized) coaching as a toast. (`useCoachingListener` hook also available.)
- **Tests:** api client, calculate validation, RiskSummary component.
- **Note:** the working tree's `getBaseUrl` was changed (not by this work) to ignore the configured URL in `__DEV__`; aligned `api/index-test`'s dev case to that behavior.

## Resolved open questions
- **Lot step:** 0.01 for forex/metals/energy, **0.001 for crypto**; `MIN_LOT_SIZE = 0.001` hard floor. Plus an **optional user lot override** on `/risk/calculate` + `/risk/trades`: when the trader supplies `lot`, exposure is computed from it (floored to the instrument step) while `lotSize` still reports the engine's recommendation.
- **Tiering:** Phase 1 ships **ungated** — AI coaching and all features available to any authenticated user. Real tier/billing is a later effort.

## PR6 — AI coaching (Anthropic primary → OpenAI fallback)
- `src/risk/coaching/`: `coaching.interface.ts` (`CoachingProvider`, `COACHING_PROVIDER` token), `coaching.prompt.ts` (pure, language-aware system+user prompt; leads with blocking reason; account-currency symbol; excludes informational checks), `anthropic.provider.ts` (lazy client, prompt caching on the system block, model `ANTHROPIC_COACHING_MODEL` default `claude-sonnet-4-6`), `openai.provider.ts` (lazy, `OPENAI_COACHING_MODEL` default `gpt-4o-mini`), `coaching.provider-factory.ts` (`createFailoverCoachingProvider` — Anthropic→OpenAI, mirrors quote module's `useFactory`), `coaching.service.ts` (returns null, never throws), `coaching.processor.ts` (BullMQ `risk-coaching` queue).
- **Flow:** `POST /risk/trades` enqueues a coaching job → processor generates → persists to `governanceLog.aiCoaching` → pushes `coaching_ready` via the existing `QuoteGateway` (per-user room). Non-blocking: enqueue/generation failure never fails the trade log.
- Env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `*_COACHING_MODEL` (documented in `.env.example`). SDKs `@anthropic-ai/sdk`, `openai` added.
- Tests: prompt builder, failover factory, service (graceful-null), processor (persist+emit), trade-log enqueue. 

### PR4 — `POST /risk/calculate` (engine + live FX + governance)
> Branch: `feat-risk-engine`
> Sources: `Zenlot_Phase1_Risk_Engine_Spec.pdf`, `Zenlot_Complete_Architecture_Specification.pdf` (Part III)

---

## ✅ Delivered so far

### PR1 — Deterministic engine core (`src/risk/engine/`)

Pure, framework-free, exhaustively unit-tested (53 tests). "AI never calculates" enforced structurally — no I/O in this folder.
- `types.ts` — `RiskProfile`, `TradeSetupInput`, `RiskCalculation`, `PortfolioSnapshot`, `DrawdownState`, `GovernanceCheck/Result` (engine speaks `direction: long|short`).
- `instruments.ts` — `CONTRACT_SIZE` (ported from FE), `getInstrumentType`/`getContractSize`/`getPipSize`/`getValuePerLot`/`getLotStep`, `MIN_LOT_SIZE`. Multi-instrument (forex + metals + crypto + energy).
- `calculations.ts` — unified money model `capitalExposure = |entry−stop| × lot × contractSize × exchangeRate` (proven equal to spec for forex across all 3 pip-value cases); `calculatePositionSize` (floor-rounds lot DOWN, guards bad inputs via `RiskCalculationError`), `calculateRewardToRisk`, `calculateRMultiple`, `calculatePnL`, `calculateDrawdown`, `computeRiskCalculation` (composer), `floorToStep`.
- `correlations.ts` — `CORRELATION_GROUPS` + `getCorrelatedPairs` (spec §11.3 verbatim) + disclaimer.
- `governance.ts` — `checkRule` (block ≥limit, warn ≥80%), `checkCircuitBreaker` (sticky breach), `checkCorrelatedExposure`, `evaluateGovernance` (7 checks), `deriveOverallStatus`.
- **Boundary note:** a trade sized to *exactly* the per-trade limit blocks (`actual >= limit`); floor-rounding normally lands just under, so real sized trades pass.

### PR5 — Trade logging + close + drawdown + cron + i18n

- **Governance tweak:** the per-trade capital-exposure check is now `informational` (a `GovernanceCheck.informational` flag); `deriveOverallStatus` and `blockedReason` ignore informational checks, so a correctly-sized trade is no longer warned/blocked by its own sizing. Status still computed for display.
- **i18n:** `engine/i18n.ts` (`Language`, `resolveLanguage`, `governanceMessage`) localizes governance messages + `blockedReason`; `CORRELATION_DISCLAIMER(language)`. Threaded from `user.language` (en/fr today, expandable — `rule` keys stay stable English). Mirrors the existing email i18n convention.
- **Tables (migration `20260613224835_add_drawdown_and_governance_log`):** `drawdownState` (1:1 user) + `governanceLog` (immutable audit).
- **`DrawdownService`:** `getState` (lazy-create, recompute %), `applyBalanceDelta` (tx-aware, sticky breach flags), `resetCircuitBreakers` (daily always / weekly Mon / monthly 1st, UTC).
- **`RateResolverService`:** extracted FX quote→account resolution (reused by calculate + close).
- **`TradeLogService`:** `logTrade` (`POST /risk/trades` — re-sizes + re-governs server-side, rejects blocked with 422, writes `governanceLog`) and `closeTrade` (`PATCH /risk/trades/:id/close` — PnL + R-multiple, atomic trade + balance + drawdown update; balance auto-update marks `lastBalanceSource='trade_close'`).
- **Cron:** `DrawdownResetProcessor` (BullMQ, `0 0 * * *` UTC) calls `resetCircuitBreakers`.
- **Read endpoints added:** `GET /risk/portfolio`, `GET /risk/drawdown`.
- **Real drawdown wired into `/risk/calculate`** (replaced the PR4 neutral stub — circuit-breaker checks are now live).
- 94 risk tests pass; full backend 41 suites / 184 tests; tsc + lint clean.

### PR4 — `POST /risk/calculate` (engine + live FX + governance)

- `risk.mapper.ts` — the **execution↔direction boundary** (buy≡long, sell≡short): `executionToDirection`/`directionToExecution`, `toRiskCalculationView` (returns app vocabulary: `symbol`/`execution`/`entry`), `neutralDrawdownState`. The engine stays pure long/short; all buy/sell translation lives here.
- `portfolio.service.ts` — `PortfolioSnapshot` from open trades, mapping each trade's `execution`→`direction`; null exposure (pre-engine trades) → 0.
- `risk-calculation.service.ts` — `calculate()`: loads profile (rejects if balance ≤0), resolves the **quote→account exchange rate** via `QuoteService.fxRate({base: quoteCcy, quote: accountCcy})` (=1 when quote===account; inverse-pair fallback; `503 "Live rate unavailable. Refresh to retry."` if both fail — spec §11.1), sizes via engine, runs governance, returns `{ calculation (view), governance }`. `RiskCalculationError` → 400.
- `dto/calculate-risk.dto.ts` — `{ symbol, execution: buy|sell, entry, stopPrice, targetPrice? }`; account currency from the authed user.
- Trade table extended (migration `20260613023142_add_trade_risk_fields`): `capitalExposure`, `capitalExposurePct`, `governanceStatus`, `pnl`, `rMultiple` (all nullable).
- 25 tests (mapper, portfolio, calculation service). Exchange-rate **direction confirmed** against the frontend's existing `get-exchange-rate` convention.
- **Two governance nuances surfaced (faithful to spec):** (1) the per-trade check warns at ≥80% of the limit, and the sizer targets the limit, so an engine-sized trade is *normally a `warning`* on the per-trade check and `blocked` at exactly 100%; (2) drawdown circuit-breaker checks are **inert** (neutral state) until PR5 lands `drawdownState`.

### PR3 — RiskProfile vertical slice

End-to-end user-configurable risk profile (the spec's `RiskProfile` inputs the frontend was missing), both repos:

**Backend (`zenlot-server`)**
- `prisma/schema.prisma`: new `riskProfile` model (1:1 with `user`) + `user.riskProfile` relation. Migration `20260612235902_add_risk_profile` created & applied locally.
- `src/risk/`: `risk.module.ts`, `risk.controller.ts` (`GET /risk/profile`, `PUT /risk/profile`), `risk-profile.service.ts` (lazy-creates defaults 1/3/5/8/10/5/6; stamps `lastBalanceSource='manual'` + `lastBalanceSetAt` on balance change; audit-logged, non-blocking), `dto/update-risk-profile.dto.ts` (class-validator bounds: pct 0.01–100, openTrades int 1–100, balance ≥0). Registered in `app.module.ts`. `accountCurrency` sourced from `user` (no duplication).
- Tests: `risk-profile.service.spec.ts` (6 tests). Lint + `tsc` clean.

**Frontend (`zenlot`)**
- `types/risk.ts` (`IRiskProfile`, `RiskProfileUpdate`), `validations/risk.ts` (`updateRiskProfileValidation`, bounds mirror backend), `api/risk.ts` (`riskApi.getProfile/updateProfile`), `lib/riskProfileForm.ts` (`RISK_FIELDS`, `buildRiskProfileUpdate`). Barrels updated.
- `app/(protected)/(profile)/tradingrules.tsx`: Risk Profile section added — 8 numeric inputs (balance + governance limits), loaded on mount, saved alongside trading rules. Localization keys added (en + fr).
- Tests: `__tests__/validations/risk-validation-test.ts`, `__tests__/lib/riskProfileForm-test.ts`, `__tests__/api/risk-test.ts` (14 tests); existing `profile-tradingrules-test.tsx` updated for the new inputs.

**Verification:** backend 96/96 tests; frontend 190/190 tests; both typecheck clean.

> Decision made for "essentials vs full": shipped the **full** RiskProfile. Placement: **extended Trading Rules screen** (not a separate screen). Persistence: **full vertical slice**.

---

## 0. Locked decisions (from product owner)

1. **Extend the existing `trade` model** — reuse current `symbol` / `execution (buy|sell)` / `lot` naming, map spec concepts onto it, add new risk columns + 3 new tables. Do **not** rename the live model or break the frontend.
2. **Preserve multi-instrument support** — generalize the spec's forex-only pip model to also cover the `CONTRACT_SIZE` instruments the app already supports (gold, silver, copper, oil/gas, BTC/ETH/LTC/XRP, etc.).
3. Spec stack assumption (NestJS) is **correct**. Reuse existing patterns: Fastify, Prisma 7, BullMQ, Socket.IO, JWT guard, Sentry, class-validator.

### Naming map (spec ⇄ this codebase)

| Spec term | This codebase | Notes |
|---|---|---|
| `pair` | `symbol` | keep `symbol` |
| `direction: long\|short` | `execution: buy\|sell` | `long≡buy`, `short≡sell`; map at boundaries |
| `entryPrice` | `entry` | |
| `stopPrice` | `stopLoss.value` (JSON) | |
| `targetPrice` | `takeProfit.value` (JSON) | |
| `lotSize` | `lot` | |
| `rewardToRisk` | `rr` | recompute correctly (current `getRatio` is buggy) |
| `capitalExposure` / `capitalExposurePct` | **new columns** | currently not tracked |
| `pnl`, `rMultiple` | **new columns** | currently computed client-side, not stored |
| `governanceStatus` | **new column** | |
| `exitPrice` | `closedPrice` | |
| `openedAt` | `createdAt` | |

---

## 1. Module layout

New NestJS feature module `src/risk/` following the existing per-domain convention (`trade/`, `quote/`):

```
src/risk/
  risk.module.ts
  risk.controller.ts            # /risk/* endpoints
  risk.service.ts               # orchestration: calc + governance + persistence
  profile.service.ts            # risk_profiles CRUD + balance reconciliation
  portfolio.service.ts          # PortfolioSnapshot from open trades
  drawdown.service.ts           # DrawdownState read/update
  drawdown-reset.processor.ts   # BullMQ cron @ 00:00 UTC (reuse pattern)
  coaching.service.ts           # async Claude coaching (Anthropic SDK)
  coaching.processor.ts         # BullMQ job for coaching (keeps API latency out of request)
  engine/                       # PURE functions — no DB, no I/O, no Nest deps
    calculations.ts             # position size, pip value, R:R, R-multiple, drawdown, PnL
    governance.ts               # deterministic pass/warn/block
    correlations.ts             # static correlation table + lookup
    instruments.ts              # CONTRACT_SIZE / instrument detection / pip size (shared w/ FE logic)
    types.ts                    # RiskProfile, RiskCalculation, GovernanceResult, etc.
  dto/                          # class-validator request DTOs
```

`engine/*` is the deterministic core. It is **framework-free and 100% unit-tested** — this is where "AI never calculates" is enforced structurally.

---

## 2. The unified multi-instrument calculation model (key design)

The spec's pip-value math is forex-only (3 cases). The frontend's `getCurrencyValue` already generalizes money value across instruments as:

```
moneyValue = |entry − exit| × lot × CONTRACT_SIZE[instrument] × exchangeRate
```

These two are reconcilable. Define a single **value-per-lot-per-unit-price**:

```
valuePerLot = CONTRACT_SIZE[instrument] × exchangeRate     // exchangeRate = quote→account FX rate
```

Then position sizing becomes instrument-agnostic and still numerically matches the spec for forex:

```
maxCapitalExposure    = accountBalance × (maxRiskPct / 100)
priceDistance         = |entryPrice − stopPrice|
stopDistancePips      = priceDistance / pipSize            // for display / spec parity
lotSize               = maxCapitalExposure / (priceDistance × valuePerLot)
lotSizeRounded        = floorToLotStep(lotSize, instrument) // round DOWN, never exceed risk
actualCapitalExposure = lotSizeRounded × priceDistance × valuePerLot
capitalExposurePct    = actualCapitalExposure / accountBalance × 100
pipValue              = pipSize × valuePerLot              // per-lot, surfaced for UI/spec
```

**Verification that this equals the spec for forex** (`CONTRACT_SIZE.forex = 100_000`):
- Case 1 (quote = account, EURUSD/USD): `exchangeRate = 1` → `pipValue = pipSize × 100000` ✓
- Case 2 (base = account, USDCAD/USD): `exchangeRate = 1/price` (CAD→USD) → `pipValue = pipSize × 100000 / price` ✓
- Case 3 (cross, EURGBP/USD): `exchangeRate = GBPUSD` (quote→account) → `pipValue = pipSize × 100000 × GBPUSD` ✓

So: **the money math runs on price-distance × contractSize × exchangeRate (covers all instruments); pip values are derived for display.** The existing `QuoteService.fxRate({base,quote})` supplies the quote→account rate (this is the spec's `rateService.getRate`).

### Lot-step / rounding precision (open item)
Spec rounds to `0.01` micro-lots. Frontend `MIN_LOT_SIZE = '0.001'`. Crypto `CONTRACT_SIZE` values are tiny (`0.0001`) so `0.01` rounding can be wrong for those. Proposal: a per-instrument `LOT_STEP` map (forex/metals `0.01`, crypto finer), always `Math.floor` to the step. **Confirm desired steps per instrument class.**

---

## 3. Database changes

### 3.1 Extend `trade` (additive, non-breaking — all new columns nullable/defaulted)

```prisma
model trade {
  // ...existing fields unchanged...
  capitalExposure     Float?     // dollar amount at risk (account currency)
  capitalExposurePct  Float?     // % of account balance
  governanceStatus    String?    // 'approved' | 'warning' | 'blocked'
  pnl                 Float?      // realized PnL on close (account currency)
  rMultiple           Float?      // signed R-multiple on close
  riskProfileSnapshot Json?       // optional: profile values used at log time (audit)
}
```
Existing statuses already cover open/closed/reached_tp/reached_sl/closed_in_profit/closed_in_loss. Spec's `cancelled` can be added to the allowed set if needed (low priority for Phase 1).

### 3.2 New table: `risk_profiles` (1:1 with user)

```prisma
model riskProfile {
  userId                  String   @id
  user                    user     @relation(fields: [userId], references: [id], onDelete: Cascade)
  maxRiskPerTradePct      Float    @default(1.0)
  maxPortfolioExposurePct Float    @default(3.0)
  maxDailyDrawdownPct     Float    @default(5.0)
  maxWeeklyDrawdownPct    Float    @default(8.0)
  maxMonthlyDrawdownPct   Float    @default(10.0)
  maxOpenTrades           Int      @default(5)
  maxCorrelatedExposure   Float    @default(6.0)
  accountBalance          Float
  lastBalanceSetAt        DateTime @default(now())
  lastBalanceSource       String   @default("manual") // 'manual' | 'trade_close'
  updatedAt               DateTime @updatedAt
}
```
`accountCurrency` already lives on `user` — **source it from `user`, don't duplicate** (avoids drift). `timezone` also already on `user`.

### 3.3 New table: `drawdown_state` (1:1 with user)

```prisma
model drawdownState {
  userId             String   @id
  user               user     @relation(fields: [userId], references: [id], onDelete: Cascade)
  accountBalance     Float
  peakBalance        Float
  dailyOpenBalance   Float
  weeklyOpenBalance  Float
  monthlyOpenBalance Float
  dailyDrawdownPct   Float    @default(0)
  weeklyDrawdownPct  Float    @default(0)
  monthlyDrawdownPct Float    @default(0)
  allTimeDrawdownPct Float    @default(0)
  dailyBreached      Boolean  @default(false)
  weeklyBreached     Boolean  @default(false)
  monthlyBreached    Boolean  @default(false)
  updatedAt          DateTime @updatedAt
}
```

### 3.4 New table: `governance_log` (immutable audit)

```prisma
model governanceLog {
  id            String   @id @default(uuid())
  userId        String
  user          user     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tradeId       String?
  overallStatus String
  checksJson    Json     // GovernanceCheck[]
  blockedReason String?
  aiCoaching    String?  // populated async
  createdAt     DateTime @default(now())
  @@index([userId])
  @@index([tradeId])
}
```

**Migration workflow:** follow existing convention — `prisma migrate dev` locally, named migration (e.g. `add_risk_engine`), then `db:migrate:dev/prod` scripts. All additive → safe on existing data. A `riskProfile` + `drawdownState` row is lazily created (upsert) for a user on first risk interaction, seeded from current `user.accountCurrency` and a balance the user supplies.

---

## 4. `engine/calculations.ts` (pure, unit-tested)

```ts
getPipSize(symbol): number                       // 0.01 JPY / 0.0001 else (port spec + FE)
getInstrumentType(symbol): InstrumentType        // reuse FE logic
getContractSize(symbol): number                  // CONTRACT_SIZE map
getValuePerLot(symbol, exchangeRate): number     // contractSize × exchangeRate
calculatePositionSize(input): RiskCalculation     // the unified model in §2
calculateRewardToRisk(entry, stop, target, pipSize): {rewardPips, rewardToRisk}
calculateRMultiple(entry, exit, stop, direction): number
calculatePnL(trade, exitPrice): number           // |move| × lot × contractSize × closedExchangeRate, signed
calculateDrawdown(current, dOpen, wOpen, mOpen, peak): {daily,weekly,monthly,allTime}
```
`pipValue` is fetched/assembled in `risk.service` (needs live FX via `QuoteService`), then passed into the pure functions — keeping `calculations.ts` free of I/O. If FX is unavailable, throw `RateUnavailableError` → surface "Live rate unavailable. Refresh to retry." (spec §11.1); trade cannot be logged without a valid pip value.

---

## 5. `engine/governance.ts` (deterministic, no AI)

Port spec §14 verbatim:
- `checkRule(rule, actual, limit, msg)` → `blocked` if `actual ≥ limit`, `warning` if `≥ 0.8×limit`, else `approved`.
- `checkCircuitBreaker(rule, actual, limit, alreadyBreached)` → breached/over-limit = `blocked`.
- `evaluateGovernance(calc, portfolio, drawdown, profile)` runs 6 checks: per-trade exposure, projected portfolio exposure, open-trade count, daily DD breaker, monthly DD breaker, min R:R (warn-only <2.0), **plus correlated-exposure check** (§14.1). Returns `overallStatus = worst(checks)`, `blockedReason`, `aiCoaching: null`.

Governance returns **synchronously**. Trade logging (`POST /risk/trades`) is rejected when `overallStatus === 'blocked'`.

---

## 6. `engine/correlations.ts`

Port `CORRELATION_GROUPS` + `getCorrelatedPairs(pair, direction)` from spec §11.3 verbatim. `portfolio.service` uses it to sum same-direction correlated exposure for the governance check. UI disclaimer string included as an exported constant.

---

## 7. Drawdown + circuit-breaker reset

- `drawdown.service` recomputes `DrawdownState` whenever balance changes (on trade close).
- `drawdown-reset.processor.ts`: BullMQ **repeatable job at 00:00 UTC daily** (reuse the `trade-auto-close.processor` pattern). Resets daily breaker every day; weekly on Monday; monthly on the 1st (spec §14.2). All timestamps UTC; FE converts for display.
- Edge case (23:58 breach → 00:00 reset clears it) is correct per spec — no special handling.

---

## 8. Trade lifecycle integration

**Create (`POST /risk/trades`)** — governance-gated:
1. Build `TradeSetupInput` from request (+ resolve `direction` from `execution`).
2. Fetch live FX rate (`QuoteService.fxRate`) → `pipValue` / `valuePerLot`.
3. `calculatePositionSize` → `RiskCalculation` (server computes `lotSize`; per spec, size is an **output**).
4. Build `PortfolioSnapshot` + `DrawdownState`, run `evaluateGovernance`.
5. If `blocked` → 422 with `GovernanceResult`. Else persist `trade` (existing table + new columns) and a `governance_log` row.
6. Enqueue async coaching job. Return `{ calculation, governance }` immediately.

**Close (`PATCH /risk/trades/:id/close`)** — new dedicated endpoint (today it's `PUT /trade/:id` full-update):
1. `calculatePnL` + `calculateRMultiple`.
2. Transaction: update trade (`closedPrice`, `pnl`, `rMultiple`, `status`, `closedAt`) → `incrementAccountBalance(pnl)` on `riskProfile` + `drawdownState.accountBalance` → recompute drawdown → set `lastBalanceSource='trade_close'` (spec §11.2). Reuse existing auto-close service's rate-fetch where it overlaps.

---

## 9. AI coaching layer (async, additive dependency)

- Add `@anthropic-ai/sdk`. Model **`claude-sonnet-4-6`** (per arch spec). Use the `claude-api` skill conventions incl. **prompt caching** on the static system prompt.
- Runs as a **BullMQ job** (`coaching.processor`) so Claude latency never blocks governance (spec §15). On completion: write `governance_log.ai_coaching`, emit Socket.IO `coaching_ready` to the user (Socket.IO already wired in `quote`/`user` gateways).
- System prompt per spec §15: never recalculates, ≤80 words unless circuit breaker, leads with blocking reason, uses account-currency symbol.
- **Tier-gated** (see §11): coaching only for Pro+; Free users get `aiCoaching: null` with no job enqueued.

---

## 10. API surface

Existing app has **no global prefix** (`/trade`, `/user`). To stay consistent, mount as `@Controller('risk')` → `/risk/*`. (If you want the spec's literal `/api/v1/risk`, we add `setGlobalPrefix('api/v1')` + versioning — that's a global change affecting all routes; recommend deferring.) DTOs use **class-validator** (matches backend; not zod).

| Method | Route | Body / Query | Returns |
|---|---|---|---|
| POST | `/risk/calculate` | `TradeSetupInput` | `{ calculation, governance }` (coaching null) |
| GET | `/risk/profile` | — | `RiskProfile` |
| PUT | `/risk/profile` | `Partial<RiskProfile>` (bounds-validated) | updated `RiskProfile` |
| GET | `/risk/portfolio` | — | `PortfolioSnapshot` |
| GET | `/risk/drawdown` | — | `DrawdownState` |
| POST | `/risk/trades` | `{ setupInput, calculationId }` | `TradeRecord` (requires not `blocked`) |
| PATCH | `/risk/trades/:id/close` | `{ exitPrice }` | updated `TradeRecord` |
| GET | `/risk/trades` | `status, limit, offset` | `TradeRecord[]` |

All routes behind the existing JWT `AuthGuard`; `userId` from `req.user.id`.

---

## 11. Tier gating — gap & proposal

There is **no tier/subscription/billing concept in the backend today** (`user.role` exists but is not a tier). The spec gates: AI coaching (Pro+), trade-log volume (Free 20/mo), drawdown periods, CSV export, correlated pairs.

**Proposal for Phase 1:** add `user.tier String @default("free")` (`'free'|'pro'|'performance'`) + a small `TierService` with capability checks. Enforce only the gates Phase 1 actually ships (coaching = Pro+, trade-log cap for Free). Full billing integration is out of scope. **Confirm**: add the `tier` field now, or stub all users as `pro` for Phase 1 and defer gating entirely?

---

## 12. Frontend bridge (separate, follow-up work — not in this server PR)

The server now owns position sizing + governance. Frontend changes (later, in the `zenlot` repo):
- Replace client-side `getRatio` (buggy `%`) / manual `lot` entry with calls to `POST /risk/calculate`; render returned `lotSize`, `capitalExposure`, `GovernanceResult` badges + async coaching via the existing Socket.IO connection.
- Add account-balance + risk-profile settings UI (`GET/PUT /risk/profile`); balance currently doesn't exist on the client.
- Keep `execution: buy|sell` in the UI; the API maps to `direction` internally.
- Surface drawdown/circuit-breaker state and correlated-exposure disclaimer.
This plan keeps the existing create/list endpoints working so the frontend can migrate incrementally.

---

## 13. Testing strategy

- **`engine/*` pure unit tests (highest priority):** `calculations.ts` (all 3 forex pip cases + ≥2 non-forex instruments, floor-rounding, R-multiple sign for long/short, drawdown clamping ≥0), `governance.ts` (approve/warn-at-80%/block-at-100%, circuit-breaker sticky-breach, correlated exposure), `correlations.ts` (group membership). Target near-100% on `engine/`.
- **Service tests:** profile upsert + balance reconciliation; portfolio snapshot aggregation; close-trade transaction (balance + drawdown update).
- **e2e:** governance-blocked create returns 422; happy-path calculate→log→close; profile bounds validation.
- Follow existing `*.spec.ts` collocated + `test/` e2e conventions; mock `QuoteService` and Anthropic.

---

## 14. Build sequence (suggested PRs)

1. **PR1 — Engine core (no DB):** `engine/{instruments,calculations,correlations,governance,types}.ts` + exhaustive unit tests. Pure, reviewable in isolation, zero risk.
2. **PR2 — Schema + migration:** extend `trade`, add `riskProfile` / `drawdownState` / `governanceLog`, lazy upsert + seed.
3. **PR3 — Profile + portfolio + drawdown services & endpoints** (`/risk/profile`, `/portfolio`, `/drawdown`).
4. **PR4 — Calculate + governance endpoint** (`/risk/calculate`) wiring engine + live FX.
5. **PR5 — Trade logging + close** (`/risk/trades`, `/risk/trades/:id/close`) with balance/drawdown updates + cron reset processor.
6. **PR6 — AI coaching** (Anthropic SDK, BullMQ job, Socket.IO event) + tier gating.

Each PR is independently shippable and testable.

---

## 15. Open questions to confirm before coding

1. **Lot-step precision per instrument class** (§2) — forex/metals `0.01`; what for crypto?
2. **Tier gating** (§11) — add `user.tier` now, or stub everyone as `pro` and defer?
3. **Route prefix** — `/risk/*` (consistent with current bare routes) vs. spec-literal `/api/v1/risk` (global change)?
4. **Account balance bootstrap** — on first use, prompt the user for a starting balance via `PUT /risk/profile`? (No balance exists today.)
5. **`exchangeRate` direction** — confirm `QuoteService.fxRate` / the frontend's stored `exchangeRate` is **quote→account** (the model in §2 assumes this).
```
