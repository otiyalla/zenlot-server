-- Link each pre-trade evaluation to the checklist that produced it. Nullable
-- preserves compatibility with rows written before this relation existed.
ALTER TABLE "preTradeEvaluation" ADD COLUMN "checklistId" TEXT;

CREATE UNIQUE INDEX "preTradeEvaluation_checklistId_key"
  ON "preTradeEvaluation"("checklistId");

ALTER TABLE "preTradeEvaluation"
  ADD CONSTRAINT "preTradeEvaluation_checklistId_fkey"
  FOREIGN KEY ("checklistId") REFERENCES "preTradeChecklist"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
