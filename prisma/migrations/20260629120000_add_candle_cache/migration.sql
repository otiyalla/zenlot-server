-- CreateTable
CREATE TABLE "candle" (
    "pair" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candle_pkey" PRIMARY KEY ("pair","timeframe","ts")
);

-- CreateIndex
CREATE INDEX "candle_pair_timeframe_ts_idx" ON "candle"("pair", "timeframe", "ts" DESC);
