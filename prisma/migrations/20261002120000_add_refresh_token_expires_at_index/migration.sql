-- The daily purge of expired refresh tokens filters on expiresAt.
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
