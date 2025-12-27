-- AlterTable
ALTER TABLE "journal" ADD COLUMN     "title" TEXT,
ADD COLUMN     "tradeId" INTEGER;

-- AddForeignKey
ALTER TABLE "journal" ADD CONSTRAINT "journal_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
