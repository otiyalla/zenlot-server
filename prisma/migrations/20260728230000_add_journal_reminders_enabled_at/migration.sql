ALTER TABLE "notificationPreference"
ADD COLUMN "journalRemindersEnabledAt" TIMESTAMP(3);

-- Existing rows have historically used createdAt as their scheduling boundary.
-- Preserve that behavior instead of treating this migration as a fresh opt-in.
UPDATE "notificationPreference"
SET "journalRemindersEnabledAt" = "createdAt";

ALTER TABLE "notificationPreference"
ALTER COLUMN "journalRemindersEnabledAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "journalRemindersEnabledAt" SET NOT NULL;
