/*
  Warnings:

  - Made the column `accountCurrency` on table `trade` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "trade" ALTER COLUMN "accountCurrency" SET NOT NULL;
