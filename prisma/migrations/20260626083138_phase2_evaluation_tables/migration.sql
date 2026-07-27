-- AlterTable
ALTER TABLE "trade" ADD COLUMN     "stopAdjustments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "suggestedLot" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "tradingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "entryConditions" JSONB NOT NULL,
    "stopRules" JSONB NOT NULL,
    "exitRules" JSONB NOT NULL,
    "sessionRules" JSONB NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tradingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preTradeChecklist" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "userId" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preTradeChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preTradeEvaluation" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "userId" TEXT NOT NULL,
    "setupQualityTotal" DOUBLE PRECISION NOT NULL,
    "setupQualityGrade" TEXT NOT NULL,
    "setupBreakdown" JSONB NOT NULL,
    "planAdherenceTotal" DOUBLE PRECISION,
    "planAdherenceGrade" TEXT,
    "planViolations" JSONB,
    "recommendation" TEXT NOT NULL,
    "aiCoaching" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preTradeEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executionGrade" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryQualityScore" DOUBLE PRECISION NOT NULL,
    "stopQualityScore" DOUBLE PRECISION NOT NULL,
    "stopLogic" TEXT NOT NULL,
    "exitQualityScore" DOUBLE PRECISION NOT NULL,
    "exitType" TEXT NOT NULL,
    "overallExecutionScore" DOUBLE PRECISION NOT NULL,
    "gradedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executionGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tradeVerdict" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "lucky" BOOLEAN NOT NULL DEFAULT false,
    "processScore" DOUBLE PRECISION NOT NULL,
    "outcome" TEXT NOT NULL,
    "matrix" TEXT NOT NULL,
    "aiCoaching" TEXT,
    "coachingFocus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tradeVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioralReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradesAnalyzed" INTEGER NOT NULL,
    "periodDays" INTEGER NOT NULL DEFAULT 90,
    "patterns" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "topPriority" TEXT,
    "aiSummary" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavioralReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tradingPlan_userId_idx" ON "tradingPlan"("userId");

-- CreateIndex
CREATE INDEX "preTradeChecklist_userId_idx" ON "preTradeChecklist"("userId");

-- CreateIndex
CREATE INDEX "preTradeChecklist_tradeId_idx" ON "preTradeChecklist"("tradeId");

-- CreateIndex
CREATE INDEX "preTradeEvaluation_userId_evaluatedAt_idx" ON "preTradeEvaluation"("userId", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX "preTradeEvaluation_tradeId_idx" ON "preTradeEvaluation"("tradeId");

-- CreateIndex
CREATE INDEX "executionGrade_userId_idx" ON "executionGrade"("userId");

-- CreateIndex
CREATE INDEX "executionGrade_tradeId_idx" ON "executionGrade"("tradeId");

-- CreateIndex
CREATE INDEX "tradeVerdict_userId_createdAt_idx" ON "tradeVerdict"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "tradeVerdict_tradeId_idx" ON "tradeVerdict"("tradeId");

-- CreateIndex
CREATE INDEX "behavioralReport_userId_idx" ON "behavioralReport"("userId");

-- AddForeignKey
ALTER TABLE "tradingPlan" ADD CONSTRAINT "tradingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preTradeChecklist" ADD CONSTRAINT "preTradeChecklist_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preTradeChecklist" ADD CONSTRAINT "preTradeChecklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preTradeEvaluation" ADD CONSTRAINT "preTradeEvaluation_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preTradeEvaluation" ADD CONSTRAINT "preTradeEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executionGrade" ADD CONSTRAINT "executionGrade_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executionGrade" ADD CONSTRAINT "executionGrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tradeVerdict" ADD CONSTRAINT "tradeVerdict_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "trade"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tradeVerdict" ADD CONSTRAINT "tradeVerdict_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "behavioralReport" ADD CONSTRAINT "behavioralReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Partial unique index: only one CURRENT TradingPlan per user. Prisma cannot
-- express a `WHERE "isCurrent" = true` partial unique in schema.prisma, so it is
-- declared here as raw SQL. Saving a new plan must flip the previous plan's
-- isCurrent to false in the same transaction to satisfy this constraint.
CREATE UNIQUE INDEX "tradingPlan_userId_current_key" ON "tradingPlan"("userId") WHERE "isCurrent" = true;
