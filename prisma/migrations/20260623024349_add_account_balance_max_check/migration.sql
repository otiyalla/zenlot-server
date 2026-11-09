-- Enforce an upper sanity bound on account equity at the database level.
-- Mirrors @Max(1_000_000_000_000) on UpdateRiskProfileDto.
--
-- The lower bound is intentionally NOT enforced here: closing a losing trade
-- increments "accountBalance" by a negative realized PnL and may legitimately
-- drive a blown account below zero, which a "accountBalance >= 0" CHECK would
-- abort. The 0 floor is enforced only on manual entry via the DTO @Min(0).
ALTER TABLE "riskProfile"
  ADD CONSTRAINT "riskProfile_accountBalance_max"
  CHECK ("accountBalance" <= 1000000000000);
