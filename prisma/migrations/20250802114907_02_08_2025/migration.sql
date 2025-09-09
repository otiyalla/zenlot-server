/*
  Warnings:

  - You are about to drop the column `userId` on the `trade` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "trade" DROP COLUMN "userId";

-- AddForeignKey
ALTER TABLE "trade" ADD CONSTRAINT "trade_id_fkey" FOREIGN KEY ("id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
