-- Push notifications (Expo) data model.
--
-- pushToken: one row per user device. The Expo token is globally unique; a
-- re-registration from the same device (same userId+deviceId) updates in place
-- via the composite unique. `enabled`/`lastError*` let the send pipeline
-- soft-disable tokens Expo reports as DeviceNotRegistered before reaping them.
--
-- notificationPreference: one row per user with supportive defaults (everything
-- on, no quiet hours). Quiet hours are local "HH:mm" strings evaluated against
-- the user's IANA timezone, mirroring the DST-safe drawdown reset approach.

-- CreateTable
CREATE TABLE "pushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificationPreference" (
    "userId" TEXT NOT NULL,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "tradeClosed" BOOLEAN NOT NULL DEFAULT true,
    "coachingReady" BOOLEAN NOT NULL DEFAULT true,
    "drawdownAlerts" BOOLEAN NOT NULL DEFAULT true,
    "governanceAlerts" BOOLEAN NOT NULL DEFAULT true,
    "journalReminders" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "reminderHour" INTEGER NOT NULL DEFAULT 20,
    "lastReminderLocalDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "pushToken_token_key" ON "pushToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "pushToken_userId_deviceId_key" ON "pushToken"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "pushToken_userId_idx" ON "pushToken"("userId");

-- AddForeignKey
ALTER TABLE "pushToken" ADD CONSTRAINT "pushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notificationPreference" ADD CONSTRAINT "notificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
