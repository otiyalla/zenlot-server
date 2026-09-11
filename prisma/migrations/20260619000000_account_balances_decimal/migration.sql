ALTER TABLE "riskProfile"
  ALTER COLUMN "accountBalance" TYPE DECIMAL(18, 2)
  USING ROUND("accountBalance"::numeric, 2),
  ALTER COLUMN "accountBalance" SET DEFAULT 0;

ALTER TABLE "drawdownState"
  ALTER COLUMN "accountBalance" TYPE DECIMAL(18, 2)
  USING ROUND("accountBalance"::numeric, 2),
  ALTER COLUMN "peakBalance" TYPE DECIMAL(18, 2)
  USING ROUND("peakBalance"::numeric, 2),
  ALTER COLUMN "dailyOpenBalance" TYPE DECIMAL(18, 2)
  USING ROUND("dailyOpenBalance"::numeric, 2),
  ALTER COLUMN "weeklyOpenBalance" TYPE DECIMAL(18, 2)
  USING ROUND("weeklyOpenBalance"::numeric, 2),
  ALTER COLUMN "monthlyOpenBalance" TYPE DECIMAL(18, 2)
  USING ROUND("monthlyOpenBalance"::numeric, 2);
