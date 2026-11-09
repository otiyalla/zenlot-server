-- Record when a refresh token was revoked so a token revoked by rotation can be
-- redeemed for a short grace window (lost/timed-out refresh responses) and a
-- replay after that window can be detected as token reuse.
ALTER TABLE "RefreshToken" ADD COLUMN "revokedAt" TIMESTAMP(3);
