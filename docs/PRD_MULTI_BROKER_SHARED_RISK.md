# Product Requirements Document: Multi-Broker Trading with Shared Risk Policies

**Product:** Zenlot  
**Document status:** Proposed  
**Last updated:** 2026-07-26  
**Implementation constraint:** Nx monorepo containing NestJS microservices  
**Related technical design:** [TRD: Nx NestJS Microservice Backend and Multi-Broker Architecture](./TRD_NX_MICROSERVICES_MULTI_BROKER.md)

## 1. Executive summary

Zenlot will allow one authenticated user to connect multiple broker integrations and trade across the accounts exposed by those integrations. A user creates one trade instruction and Zenlot fans it out to every selected, enabled trading account. Each account resolves its own lot size and produces an independently tracked broker execution.

Risk rules are reusable. A user may assign the same risk policy to several trading accounts or use a different policy for a particular account. Reusing a policy means sharing its configuration—such as maximum risk per trade, maximum portfolio exposure, and drawdown limits—not combining account balances or financial state. Balance, equity, margin, open exposure, drawdown, circuit breakers, broker positions, fills, and P&L remain isolated per trading account.

This replaces the current product assumption that one user is also one trading account.

## 2. Problem statement

The current backend stores account currency, risk configuration, balance, drawdown, portfolio exposure, trades, trading plans, and behavioral reporting directly against `userId`. It has no broker connection, trading account, risk-policy assignment, account selector, or broker execution model.

Consequently, using the current model for several broker accounts would:

- merge balances and realized P&L;
- calculate drawdown across unrelated accounts;
- apply portfolio and open-trade limits across every trade owned by the user;
- lose the identity of the broker account that placed a trade;
- assume every broker execution has the same fill, lifecycle, and result;
- provide no safe way to retry one failed broker submission without duplicating others; and
- prevent account-specific default lot sizing.

## 3. Product vision

A trader should be able to:

1. connect supported brokers;
2. discover and enable one or more trading accounts from each broker;
3. configure account-specific execution defaults;
4. create reusable risk policies;
5. assign one policy to many accounts or a different policy to an individual account;
6. submit one trade instruction to all selected accounts;
7. see the status, fill, size, P&L, and errors for every account independently; and
8. understand both per-account results and an aggregated read-only overview.

## 4. Fixed product decisions

The following decisions are in scope and should not be reopened during implementation unless this PRD is amended:

1. **One user may own multiple broker connections.**
2. **One broker connection may expose multiple trading accounts.**
3. **A trading account belongs to exactly one broker connection.**
4. **A risk policy is reusable across multiple trading accounts.**
5. **Shared policy means shared rules with isolated account state.**
6. **A trading account has at most one active risk-policy assignment.**
7. **One trade submission creates one trade intent and one account trade per targeted account.**
8. **Account trades are independent:** one failure does not roll back successful submissions to other accounts.
9. **Each account resolves its own lot size.**
10. **The broker is the source of truth for live order, position, balance, and fill state.**
11. **Zenlot must make retries idempotent and must not duplicate broker orders.**
12. **Pooled balance, exposure, or drawdown across accounts is not part of the initial release.**

## 5. Terminology

| Term               | Definition                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| User               | The authenticated Zenlot identity.                                                               |
| Broker connection  | An authenticated integration between a user and a broker environment.                            |
| Trading account    | A live, practice, demo, or prop account discovered through a broker connection.                  |
| Risk policy        | Reusable risk and governance configuration owned by a user.                                      |
| Policy assignment  | The active association between a trading account and a risk policy.                              |
| Account risk state | Account-specific balance, equity, exposure, drawdown, and circuit-breaker state.                 |
| Trade intent       | The user's single canonical instruction to trade an instrument.                                  |
| Account trade      | The independently sized and executed child of a trade intent for one trading account.            |
| Broker order       | The order identifier and state reported by the broker.                                           |
| Reconciliation     | Synchronizing Zenlot's projection with broker-reported account, order, fill, and position state. |

## 6. Goals

- Let users connect multiple supported brokers and accounts.
- Let users enable or disable an account without deleting its history.
- Let users reuse one risk policy across accounts.
- Keep all financial and risk state isolated per account.
- Fan one trade intent out to all selected enabled accounts.
- Resolve fixed or risk-based lot sizes independently per account.
- Represent partial success clearly and safely.
- Provide durable audit history for policy, sizing, dispatch, broker response, and reconciliation decisions.
- Preserve existing journal, evaluation, coaching, notification, and market-data capabilities.
- Migrate existing users without losing trades, journals, risk settings, or reports.

## 7. Non-goals for the initial release

- Pooled balance or drawdown across accounts.
- Shared account ownership, teams, organizations, or delegated trading.
- Social or cross-user copy trading.
- Guaranteed simultaneous fills or identical prices across brokers.
- Automatic cross-broker netting or hedging.
- Moving money between broker accounts.
- Broker onboarding or KYC.
- A universal replacement for broker-native account statements.
- Arbitrary strategy automation or algorithm hosting.
- Multi-leg orders unless explicitly added to a later broker capability phase.

## 8. Primary users and use cases

### 8.1 Multi-broker retail trader

The trader connects a live broker and a demo broker, applies the same conservative risk policy to both, and submits one trade. The live and demo accounts use different fixed lot sizes.

### 8.2 Prop-account trader

The trader connects several prop accounts. Most use one shared policy, while an account with stricter drawdown rules uses a dedicated policy.

### 8.3 Account-specific risk-based trader

The trader uses the same percentage-based policy on accounts with different balances and currencies. Zenlot calculates an independent lot size from each account's own equity and conversion rate.

### 8.4 Operational recovery

A trade reaches two accounts, but a third broker times out. Zenlot shows partial success, retries only the unresolved account with the same idempotency identity, and never duplicates the two accepted orders.

## 9. User experience requirements

### 9.1 Connect a broker

The user can:

- choose a supported broker and environment;
- complete the broker's OAuth or credential flow;
- see connection status and the time of the last successful synchronization;
- reconnect an expired or revoked connection;
- disconnect a connection after acknowledging the effect on active monitoring; and
- see actionable, non-secret error messages.

Zenlot must never display stored broker secrets after initial submission.

### 9.2 Discover and configure trading accounts

After a connection succeeds, Zenlot imports the accounts the broker exposes. For each account, the user can:

- set a display name;
- see broker, environment, masked broker account identifier, currency, and account type;
- enable or disable trade fan-out;
- choose a risk policy;
- choose a lot-sizing mode;
- set a fixed default lot size or multiplier where applicable;
- see synchronization health; and
- manually request a refresh.

Broker-reported identity fields are read-only.

### 9.3 Manage risk policies

The user can:

- create, name, view, update, archive, and duplicate a policy;
- configure the current risk and governance limits;
- assign the policy to one or more owned trading accounts;
- see which accounts use the policy;
- replace an account's policy assignment; and
- review policy version history.

Updating a shared policy affects future calculations for every assigned account. Existing account trades retain the policy version and inputs used when they were sized.

Archiving a policy is prohibited while it remains actively assigned, unless the user reassigns affected accounts in the same operation.

### 9.4 Submit one trade to many accounts

The user provides a single trade instruction containing, at minimum:

- instrument;
- side;
- order type;
- entry or trigger information when required;
- stop loss;
- optional take profit;
- optional journal content and tags; and
- target accounts, with "all enabled accounts" available as the default.

Before final confirmation, Zenlot presents an account preview containing:

- account name and broker;
- policy name and version;
- account currency;
- current broker balance/equity freshness;
- resolved lot;
- risk amount and percentage where calculable;
- governance warnings or blocks;
- unsupported broker capabilities; and
- whether the account will be submitted, skipped, or requires confirmation.

After confirmation, the UI immediately displays the trade intent as accepted and then streams the state of every account trade independently.

### 9.5 View trade results

The trade detail view must show:

- the canonical trade intent;
- aggregate status;
- one row per targeted account;
- requested and resolved lot;
- broker order and position identifiers;
- submission attempts;
- accepted, filled, rejected, cancelled, or unknown status;
- requested, fill, close, and average prices;
- realized and unrealized P&L in the account currency;
- policy and sizing snapshots;
- broker messages normalized for the user; and
- timestamps for every material transition.

## 10. Functional requirements

### 10.1 Broker connections

- **BR-001:** A user can create more than one broker connection.
- **BR-002:** Connection uniqueness is defined by user, broker, environment, and broker-side principal as supported by the broker.
- **BR-003:** A connection can expose one or more trading accounts.
- **BR-004:** Connection secrets are encrypted or stored by reference in a secrets manager.
- **BR-005:** Zenlot records connection health without logging credentials or access tokens.
- **BR-006:** Expired authorization moves the connection to `reauth_required` without deleting accounts or history.
- **BR-007:** Broker webhooks are authenticated, replay-protected, and idempotently processed.
- **BR-008:** A connection can be disabled immediately, preventing new dispatches.

### 10.2 Trading accounts

- **AC-001:** Every trading account has a stable Zenlot ID independent of the broker's identifier.
- **AC-002:** The combination of broker connection and broker account identifier is unique.
- **AC-003:** Account balance, equity, margin, currency, positions, and sync timestamps are account-specific.
- **AC-004:** Disabling an account prevents new trades but preserves history and reconciliation.
- **AC-005:** Account ownership is checked server-side for every read and write.
- **AC-006:** A user cannot target an account belonging to another user.
- **AC-007:** Account currency comes from the broker when available; manual overrides require audit history.

### 10.3 Shared risk policies

- **RP-001:** A user may own multiple risk policies.
- **RP-002:** One risk policy may be assigned to many trading accounts.
- **RP-003:** One trading account has at most one active policy assignment.
- **RP-004:** Assignments cannot cross user ownership.
- **RP-005:** Policy rules are versioned.
- **RP-006:** Account financial and drawdown state is never stored on the shared policy.
- **RP-007:** Governance calculations use the account's current state and its assigned policy version.
- **RP-008:** A policy update does not rewrite historical trade snapshots.
- **RP-009:** Circuit breakers are evaluated and reset independently for each account.
- **RP-010:** The product can display the same policy's results across assigned accounts without combining their state.

### 10.4 Lot sizing

Each trading account supports one of these modes:

| Mode         | Behavior                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `fixed`      | Use the account's configured default lot unless the trade supplies an allowed account override.                 |
| `risk_based` | Calculate lot from the account's own balance/equity, instrument geometry, conversion rate, and assigned policy. |
| `multiplier` | Apply an account-specific multiplier to a base lot supplied by the trade intent.                                |

- **LS-001:** Lot resolution occurs separately for every account trade.
- **LS-002:** The resolved lot conforms to the broker's minimum, maximum, and step size.
- **LS-003:** Rounding behavior is deterministic and visible in the preview.
- **LS-004:** A lot that rounds below the broker minimum skips or blocks only that account.
- **LS-005:** The lot-sizing inputs and output are stored as an immutable execution snapshot.
- **LS-006:** The server, not the client, performs final sizing and broker-constraint validation.

The default precedence is:

1. a permitted explicit account override;
2. the account's configured sizing mode; and
3. failure with an actionable configuration message—never an implicit global fallback.

### 10.5 Trade intent and fan-out

- **TR-001:** One user action creates exactly one trade intent for a given idempotency key.
- **TR-002:** The intent snapshots the targeted account IDs at confirmation time.
- **TR-003:** One unique account trade is created per targeted account.
- **TR-004:** Fan-out to one account does not depend on another account succeeding.
- **TR-005:** Every account trade receives a deterministic broker client-order identifier when supported.
- **TR-006:** Retrying a dispatch must not create a duplicate broker order.
- **TR-007:** The aggregate intent status is derived from its child states.
- **TR-008:** Partial success is a supported terminal or recoverable condition.
- **TR-009:** An account that becomes disabled before dispatch is skipped with a recorded reason.
- **TR-010:** Broker capabilities are validated before dispatch.
- **TR-011:** A user may cancel unresolved account trades; accepted broker orders follow broker-specific cancellation rules.
- **TR-012:** Zenlot records the difference between order acceptance, fill, position creation, and closure.

### 10.6 Risk and governance during fan-out

- **RG-001:** Pre-trade risk is calculated independently for each target account.
- **RG-002:** Open exposure includes only positions for that account.
- **RG-003:** Closing an account trade changes only that account's risk state.
- **RG-004:** A governance warning or block affects only the relevant account.
- **RG-005:** If overrides remain a product feature, acknowledgment is recorded per account trade.
- **RG-006:** Stale account equity beyond the configured freshness threshold blocks risk-based sizing for that account.
- **RG-007:** Shared policies do not cause a breach in one account to block another account.
- **RG-008:** The preview must be recalculated if material account state changes before dispatch.

### 10.7 Broker reconciliation

- **RC-001:** Broker updates are the source of truth for execution and position state.
- **RC-002:** Webhooks are used where available and periodic polling heals missed events.
- **RC-003:** Reconciliation is idempotent and monotonic where the broker lifecycle permits.
- **RC-004:** Zenlot records unknown or ambiguous states and continues reconciliation.
- **RC-005:** A local timeout must not be reported as a broker rejection.
- **RC-006:** Manual broker-side changes are imported and identified as external changes.
- **RC-007:** Balance and equity freshness are visible to the user.

### 10.8 Journals, evaluation, and coaching

- **EV-001:** A trade intent may have one canonical journal entry.
- **EV-002:** Account-specific fill and outcome data remain available to evaluations.
- **EV-003:** The product must explicitly label whether a report is per account or user-wide.
- **EV-004:** Initial migration preserves existing trading plan and behavioral history.
- **EV-005:** A policy is not the same object as a trading plan; strategy rules and financial governance remain separate.
- **EV-006:** AI coaching must not delay broker dispatch or account reconciliation.

The initial reporting default should be per account, with an optional user-wide read-only aggregation. Aggregate reports must not mutate account risk state.

### 10.9 Notifications

Users can receive:

- broker connection expired;
- account synchronization stale;
- account trade accepted, filled, rejected, or partially filled;
- trade intent partially successful;
- account-specific drawdown breach;
- broker position closed;
- coaching ready; and
- reconciliation discrepancy requiring attention.

Notifications must identify the broker account display name while avoiding full broker identifiers and secrets.

### 10.10 Audit and analytics

Audit history must capture:

- connection created, refreshed, disabled, or disconnected;
- account discovered, enabled, disabled, or configured;
- policy created, versioned, assigned, replaced, or archived;
- sizing decision and inputs;
- governance result and override;
- trade intent confirmation;
- every account dispatch attempt and broker response;
- reconciliation corrections; and
- privileged or destructive actions.

Analytics should distinguish Zenlot user signup from broker-account connection. The existing `account_created` event name must not be reused for broker trading accounts without disambiguation.

## 11. Aggregate trade status

The trade intent exposes a derived aggregate status:

| Status             | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `preparing`        | Child account trades are being validated and sized.                            |
| `dispatching`      | At least one child is awaiting broker submission.                              |
| `active`           | All non-skipped children are accepted or filled, with no unresolved failures.  |
| `partially_active` | Some children are active while others failed, were skipped, or remain unknown. |
| `failed`           | No child became active and no unresolved submission remains.                   |
| `closing`          | One or more active children are being closed.                                  |
| `closed`           | Every active child reached a terminal closed/cancelled state.                  |
| `partially_closed` | Child positions have divergent active and terminal states.                     |

The aggregate status is informational. It must never overwrite the authoritative child state.

## 12. Error and recovery behavior

- A broker timeout results in `submission_unknown`, not `rejected`.
- Unknown submissions are reconciled before a new order is attempted.
- A retry uses the same account-trade identity and broker client-order ID.
- One broker failure does not hide successful executions.
- Users receive actionable resolution steps for authentication, market closure, insufficient margin, unsupported instruments, invalid size, and broker outages.
- Destructive recovery actions require confirmation and audit history.

## 13. Security and privacy requirements

- Broker credentials and refresh tokens must be encrypted with managed keys or stored in a secrets manager.
- Services and support tools must never return raw credentials.
- Logs, Sentry events, analytics, queues, and domain events must exclude secrets.
- Broker webhook signatures and timestamps must be verified.
- Authorization must validate both user identity and trading-account ownership.
- Sensitive credential operations require stricter rate limits and audit history.
- Disconnecting a broker must revoke credentials where the provider supports revocation.
- User deletion must remove or revoke broker credentials before deleting local connection records.

## 14. Non-functional requirements

- A successfully accepted trade intent is durable before the API returns success.
- The system must tolerate individual broker and worker outages without losing accepted intent records.
- Fan-out is at-least-once internally and effectively-once at the broker boundary through idempotency.
- Account state must be eventually consistent with broker state and expose freshness.
- Policy and sizing calculations are deterministic for the same input snapshot.
- Every event and request carries correlation, causation, user, intent, and account identifiers where applicable.
- No synchronous AI provider call may sit on the trade-dispatch critical path.

Target service objectives are defined in the related TRD.

## 15. Success metrics

- Percentage of active users with at least one connected trading account.
- Average enabled trading accounts per connected user.
- Trade intents successfully fanned out to all eligible accounts.
- Partial-success rate by broker and reason.
- Duplicate broker orders caused by Zenlot: target zero.
- Median and p95 time from confirmed intent to broker acknowledgment.
- Reconciliation discrepancy rate and time to convergence.
- Risk-based sizing failure rate by reason.
- Broker connection reauthentication rate.
- Account-specific drawdown alert accuracy.

## 16. Rollout strategy

1. Migrate every existing user to one synthetic/manual trading account.
2. Expose the new account and risk-policy APIs without live broker execution.
3. Add the first broker in read-only mode for account discovery and reconciliation.
4. Enable paper/demo execution for internal users.
5. Run sizing and dispatch in shadow mode against controlled accounts.
6. Enable live execution behind user, broker, and account feature flags.
7. Expand to additional brokers using the adapter contract.
8. Retire legacy user-level account fields after compatibility and rollback windows close.

## 17. Acceptance criteria

The initial multi-broker release is complete when:

- an existing user is migrated without losing historical data;
- a user can connect the first supported broker and discover multiple accounts;
- a user can enable at least two accounts;
- a user can create one policy and assign it to both accounts;
- both accounts retain independent balance, exposure, drawdown, and circuit-breaker state;
- the accounts can use different fixed default lot sizes;
- one confirmed trade intent creates exactly one child account trade per enabled target;
- each child can succeed, fail, retry, fill, and close independently;
- a partial broker failure is visible without duplicating successful orders;
- all broker dispatches are idempotent;
- policy updates apply to future sizing while historical snapshots remain unchanged;
- ownership isolation is verified through automated tests;
- secrets are absent from application responses, logs, events, queues, and telemetry; and
- operational dashboards and alerts cover dispatch failures, stale reconciliation, queue lag, and broker health.

## 18. Product questions that remain open

These decisions do not block the architecture but must be resolved before a broker reaches live rollout:

1. Which broker and environment will be the first supported execution integration?
2. Which order types are required in the first release?
3. Should governance blocks prevent dispatch, allow per-account overrides, or remain warning-only as the current journal product does?
4. Is "all enabled accounts" always the default, or should the product remember the last target set?
5. How fresh must broker equity be for risk-based sizing?
6. Should the initial behavioral report default to one selected account or all accounts?
7. What entitlement or subscription tier governs broker connections and maximum account count?
8. Which broker-side changes should Zenlot allow users to adopt into the canonical trade intent?
