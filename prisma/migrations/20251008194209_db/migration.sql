-- AlterTable
ALTER TABLE "user" ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'system',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "togglePipValue" BOOLEAN NOT NULL DEFAULT false;
