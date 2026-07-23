-- AlterTable
ALTER TABLE "governanceLog" ADD COLUMN     "acknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "acknowledgedRules" TEXT[];

-- AlterTable
ALTER TABLE "riskProfile" ADD COLUMN     "overrideMode" TEXT NOT NULL DEFAULT 'simple';

-- AlterTable
ALTER TABLE "trade" ADD COLUMN     "overridden" BOOLEAN NOT NULL DEFAULT false;
