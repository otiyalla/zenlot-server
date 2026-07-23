-- AlterTable
ALTER TABLE "trade" ADD COLUMN     "capitalExposure" DOUBLE PRECISION,
ADD COLUMN     "capitalExposurePct" DOUBLE PRECISION,
ADD COLUMN     "governanceStatus" TEXT,
ADD COLUMN     "pnl" DOUBLE PRECISION,
ADD COLUMN     "rMultiple" DOUBLE PRECISION;
