-- CreateTable
CREATE TABLE "drawdownState" (
    "userId" TEXT NOT NULL,
    "accountBalance" DOUBLE PRECISION NOT NULL,
    "peakBalance" DOUBLE PRECISION NOT NULL,
    "dailyOpenBalance" DOUBLE PRECISION NOT NULL,
    "weeklyOpenBalance" DOUBLE PRECISION NOT NULL,
    "monthlyOpenBalance" DOUBLE PRECISION NOT NULL,
    "dailyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weeklyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allTimeDrawdownPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyBreached" BOOLEAN NOT NULL DEFAULT false,
    "weeklyBreached" BOOLEAN NOT NULL DEFAULT false,
    "monthlyBreached" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawdownState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "governanceLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT,
    "overallStatus" TEXT NOT NULL,
    "checksJson" JSONB NOT NULL,
    "blockedReason" TEXT,
    "aiCoaching" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "governanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governanceLog_userId_idx" ON "governanceLog"("userId");

-- CreateIndex
CREATE INDEX "governanceLog_tradeId_idx" ON "governanceLog"("tradeId");

-- AddForeignKey
ALTER TABLE "drawdownState" ADD CONSTRAINT "drawdownState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "governanceLog" ADD CONSTRAINT "governanceLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
