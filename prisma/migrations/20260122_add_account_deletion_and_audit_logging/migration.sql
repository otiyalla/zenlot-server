-- AlterTable user: Add soft delete and email verification fields
ALTER TABLE "user" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deleteScheduledFor" TIMESTAMP(3),
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "emailVerificationToken" TEXT,
ADD COLUMN "emailVerificationTokenExpiry" TIMESTAMP(3);

-- CreateTable auditLog
CREATE TABLE "auditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable feedback
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditLog_userId_idx" ON "auditLog"("userId");
CREATE INDEX "auditLog_action_idx" ON "auditLog"("action");
CREATE INDEX "auditLog_createdAt_idx" ON "auditLog"("createdAt");

-- CreateIndex
CREATE INDEX "feedback_userId_idx" ON "feedback"("userId");
CREATE INDEX "feedback_status_idx" ON "feedback"("status");

-- AddForeignKey
ALTER TABLE "auditLog" ADD CONSTRAINT "auditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable trade: Update cascade delete on user foreign key
-- Drop the existing constraint and recreate with CASCADE
ALTER TABLE "trade" DROP CONSTRAINT "trade_userId_fkey";
ALTER TABLE "trade" ADD CONSTRAINT "trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Add indexes for performance
CREATE INDEX "trade_userId_idx" ON "trade"("userId");
CREATE INDEX "journal_userId_idx" ON "journal"("userId");
CREATE INDEX "journal_tradeId_idx" ON "journal"("tradeId");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
