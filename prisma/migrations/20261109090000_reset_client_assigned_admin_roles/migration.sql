-- Before the admin feature, POST /auth/signup and PUT /user/:id stored any
-- `role` the client sent, and nothing on the server gave `role` a meaning.
-- Any existing 'admin' value was therefore self-assigned. Reset those rows so
-- the new RolesGuard does not grant them admin access. Trusted admins are
-- promoted afterwards with scripts/promote-admin.sql.
UPDATE "user" SET "role" = 'trader', "updatedAt" = NOW() WHERE "role" = 'admin';
