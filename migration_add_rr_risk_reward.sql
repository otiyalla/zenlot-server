-- AlterTable
-- Step 1: Add columns as nullable
ALTER TABLE "trade" ADD COLUMN "rr" DOUBLE PRECISION,
ADD COLUMN "risk" DOUBLE PRECISION,
ADD COLUMN "reward" DOUBLE PRECISION;

-- Step 2: Update existing rows with default value of 0
UPDATE "trade" SET "rr" = 0 WHERE "rr" IS NULL;
UPDATE "trade" SET "risk" = 0 WHERE "risk" IS NULL;
UPDATE "trade" SET "reward" = 0 WHERE "reward" IS NULL;

-- Step 3: Make columns NOT NULL
ALTER TABLE "trade" ALTER COLUMN "rr" SET NOT NULL,
ALTER COLUMN "risk" SET NOT NULL,
ALTER COLUMN "reward" SET NOT NULL;


