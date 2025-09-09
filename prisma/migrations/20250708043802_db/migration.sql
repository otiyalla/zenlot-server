/*
  Warnings:

  - You are about to drop the column `account_currency` on the `user` table. All the data in the column will be lost.
  - Added the required column `accountCurrency` to the `user` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "user" DROP COLUMN "account_currency",
ADD COLUMN     "accountCurrency" TEXT NOT NULL;
