-- CreateTable
CREATE TABLE "riskProfile" (
    "userId" TEXT NOT NULL,
    "maxRiskPerTradePct" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "maxPortfolioExposurePct" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "maxDailyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "maxWeeklyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "maxMonthlyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "maxOpenTrades" INTEGER NOT NULL DEFAULT 5,
    "maxCorrelatedExposure" DOUBLE PRECISION NOT NULL DEFAULT 6.0,
    "accountBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastBalanceSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBalanceSource" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riskProfile_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "riskProfile" ADD CONSTRAINT "riskProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
