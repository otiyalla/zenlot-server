-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('open', 'closed_with_profit', 'closed_with_loss', 'closed_in_break_even', 'closed_in_partial_profit', 'closed_in_partial_loss', 'reached_stop_loss', 'reached_take_profit');

-- AlterTable
ALTER TABLE "trade" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedExchangeRate" DOUBLE PRECISION,
ADD COLUMN     "closedPrice" DOUBLE PRECISION,
ADD COLUMN     "closedReason" TEXT,
ALTER COLUMN "status" SET DEFAULT 'open';
