/*
  Warnings:

  - Made the column `accountCurrency` on table `trade` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill NULL rows before enforcing NOT NULL; existing trades default to USD.
UPDATE "trade" SET "accountCurrency" = 'USD' WHERE "accountCurrency" IS NULL;

-- AlterTable
ALTER TABLE "trade" ALTER COLUMN "accountCurrency" SET NOT NULL;
