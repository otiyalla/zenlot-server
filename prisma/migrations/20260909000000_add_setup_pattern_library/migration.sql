-- SCRUM-59: a per-user library of custom trade setup pattern names, plus a link
-- table joining each declared pattern to the trade it was used on.
--
-- "customSetupPattern" is the library. The "Other" option on the pre-trade
-- checklist lets a trader type a free-text pattern name; each accepted name is
-- upserted here so it can be offered as an autocomplete suggestion on future
-- checklists. "normalizedName" is the case-folded, whitespace-collapsed form and
-- carries the per-user uniqueness constraint, so "Head and Shoulders" and
-- "head  and shoulders" stay one entry, while "name" keeps the casing the trader
-- actually typed for display.
--
-- "setupPatternUsage" is the link, one row per checklist that declared a
-- pattern. A library row is reused across many trades, so the link cannot live
-- on "customSetupPattern" itself. Rows are written for EVERY pattern type, not
-- just custom ones, so questions like "how do my head-and-shoulders trades
-- perform?" are a single indexed query rather than a scan of the checklist JSON.
-- "tradeId" is backfilled when the checklist is linked to its trade and stays
-- NULL for a setup that was declared but never logged. The evaluation and its AI
-- coaching are one join away via "checklistId", since
-- "preTradeEvaluation"."checklistId" is already unique.

-- CreateTable
CREATE TABLE "customSetupPattern" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "normalizedName" VARCHAR(64) NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customSetupPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setupPatternUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "customPatternId" TEXT,
    "customName" VARCHAR(64),
    "confidence" TEXT,
    "checklistId" TEXT,
    "tradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setupPatternUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customSetupPattern_userId_normalizedName_key"
  ON "customSetupPattern"("userId", "normalizedName");

-- CreateIndex
CREATE INDEX "customSetupPattern_userId_lastUsedAt_idx"
  ON "customSetupPattern"("userId", "lastUsedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "setupPatternUsage_checklistId_key"
  ON "setupPatternUsage"("checklistId");

-- CreateIndex
CREATE INDEX "setupPatternUsage_userId_patternType_idx"
  ON "setupPatternUsage"("userId", "patternType");

-- CreateIndex
CREATE INDEX "setupPatternUsage_tradeId_idx" ON "setupPatternUsage"("tradeId");

-- CreateIndex
CREATE INDEX "setupPatternUsage_customPatternId_idx"
  ON "setupPatternUsage"("customPatternId");

-- AddForeignKey
ALTER TABLE "customSetupPattern"
  ADD CONSTRAINT "customSetupPattern_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "setupPatternUsage"
  ADD CONSTRAINT "setupPatternUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "setupPatternUsage"
  ADD CONSTRAINT "setupPatternUsage_customPatternId_fkey"
  FOREIGN KEY ("customPatternId") REFERENCES "customSetupPattern"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "setupPatternUsage"
  ADD CONSTRAINT "setupPatternUsage_checklistId_fkey"
  FOREIGN KEY ("checklistId") REFERENCES "preTradeChecklist"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "setupPatternUsage"
  ADD CONSTRAINT "setupPatternUsage_tradeId_fkey"
  FOREIGN KEY ("tradeId") REFERENCES "trade"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
