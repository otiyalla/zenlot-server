-- Tracks the user's local calendar date (YYYY-MM-DD, in their IANA timezone) on
-- which the circuit breakers were last reset. The hourly reset job uses this to
-- fire exactly once per local day per user — DST-safe (a missing 00:00 hour is a
-- non-event) and idempotent if the job is retried after a mid-loop failure.
-- Nullable so existing rows reset on their next local-day rollover.
ALTER TABLE "drawdownState" ADD COLUMN "lastResetLocalDate" TEXT;
