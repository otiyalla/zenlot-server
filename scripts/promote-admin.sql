-- Promote an existing account to admin.
--
-- There is intentionally no API for this: self-signup and profile updates
-- always ignore the `role` field, so admins can only be created by someone
-- with direct database access.
--
-- Usage:
--   psql "$DATABASE_URL" -v email='you@zenlot.com' -f scripts/promote-admin.sql
--
-- To demote again, run the UPDATE below with role = 'trader'.

UPDATE "user"
SET "role" = 'admin', "updatedAt" = NOW()
WHERE "email" = :'email'
RETURNING "id", "email", "role";
