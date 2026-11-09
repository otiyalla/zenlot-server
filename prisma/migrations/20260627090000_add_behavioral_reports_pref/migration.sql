-- Phase 2 Inc 3: weekly behavioral-report push toggle. On by default so existing
-- users receive the weekly review unless they opt out.
ALTER TABLE "notificationPreference"
  ADD COLUMN "behavioralReports" BOOLEAN NOT NULL DEFAULT true;
