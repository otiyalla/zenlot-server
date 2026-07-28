-- Coordinate password validation with session creation so a password reset
-- can invalidate sign-ins that validated the previous credential generation.
ALTER TABLE "user" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
