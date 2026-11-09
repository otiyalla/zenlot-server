# Admin: Immediate User Deletion

## Why this exists

Before a staging environment existed, end-to-end (e2e) test runs created real
accounts in the production database. The self-service `DELETE /user/:id` route
cannot be relied on to remove them: `trade.userId` is `ON DELETE RESTRICT`, so
deleting any user who has trades fails at the database level, and the route
does not remove refresh tokens or other owned data explicitly.

This feature gives an **admin** a way to delete a user **immediately and
permanently**, together with everything they own.

## Overview

| Method   | Path               | Who        | What it does                                                        |
| -------- | ------------------ | ---------- | ------------------------------------------------------------------- |
| `GET`    | `/admin/users`     | Admin only | Lists users (id, email, name, role, createdAt). Optional `?email=`. |
| `DELETE` | `/admin/users/:id` | Admin only | Hard-deletes the user and all their data in one transaction.        |

Both routes are protected by the global `AuthGuard` (valid `access_token`
header required) **and** by `RolesGuard` with `@Roles(UserRole.ADMIN)`. The
caller's role is read from the database on every request, so promoting or
demoting an admin takes effect immediately.

The routes are also listed in Swagger under the **Admin** tag at `/api/docs`.

## Becoming an admin

There is no API to grant the admin role. An account is promoted directly in
the database:

```bash
psql "$DATABASE_URL" -v email='you@zenlot.com' -f scripts/promote-admin.sql
```

To demote, set `role` back to `'trader'`.

> **Security change shipped with this feature:** `POST /auth/signup` and
> `PUT /user/:id` now **ignore** any `role` value sent by the client. New
> accounts are always created as `trader`, and users cannot change their own
> role. Without this, anyone could have signed up as `admin` and used these
> endpoints.

### Rollout

Before this feature, signup and profile updates stored whatever `role` the
client sent, so an existing row may already say `admin` without anyone having
granted it. The migration
`prisma/migrations/20261109090000_reset_client_assigned_admin_roles` resets
every `role = 'admin'` to `trader`. Deploy in this order:

1. Apply migrations (`npx prisma migrate deploy`) **before or together with**
   the release that adds the `/admin` routes.
2. **After every old instance has stopped serving**, confirm no admins remain:
   `SELECT id, email FROM "user" WHERE role = 'admin';` should return no rows.
   During a rolling deploy, old instances still accept a client-supplied
   `role`, so one could write `admin` after the migration ran. If any rows
   appear, re-run the migration's `UPDATE` (or drain old instances before
   migrating).
3. Promote the trusted admin account(s) with `scripts/promote-admin.sql`.

## Finding the users to delete

```bash
curl -s "$API_URL/admin/users?email=e2e" \
  -H "access_token: $ADMIN_ACCESS_TOKEN"
```

`email` is a case-insensitive substring match. Password hashes are never
returned.

## Deleting a user

```bash
curl -s -X DELETE "$API_URL/admin/users/42" \
  -H "access_token: $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirmEmail": "e2e+signup@zenlot.com"}'
```

Successful response (`200 OK`):

```json
{
  "id": 42,
  "email": "e2e+signup@zenlot.com",
  "deleted": { "journals": 3, "trades": 2, "refreshTokens": 1 },
  "detachedJournals": 0
}
```

`detachedJournals` counts other users' journals that pointed at one of the
deleted trades and were kept (see below).

### What gets deleted

In a single Prisma transaction (all-or-nothing), in this order:

1. The target `user` row is locked with `SELECT ... FOR UPDATE`, and the email
   confirmation and admin checks run against that locked row. A concurrent
   promotion or email change either finishes first, and the checks see it, or
   waits until the delete is done.
2. **Other** users' journals that link to one of the target's trades get
   `tradeId = NULL`. Without this step, the `journal.tradeId` cascade would
   delete them.
3. The user's `journal` rows
4. The user's `trade` rows
5. The user's `RefreshToken` rows, which also signs them out everywhere
6. The `user` row itself

**This cannot be undone.** Take a backup first if there is any doubt.

### Safeguards

| Situation                                             | Response           |
| ----------------------------------------------------- | ------------------ |
| No / invalid token                                    | `401 Unauthorized` |
| Caller is not an admin                                | `403 Forbidden`    |
| `confirmEmail` missing or not a valid email           | `400 Bad Request`  |
| `confirmEmail` does not match the target user's email | `400 Bad Request`  |
| Admin tries to delete their own account               | `400 Bad Request`  |
| Target user is an admin (demote them first)           | `403 Forbidden`    |
| `:id` is not an integer                               | `400 Bad Request`  |
| User does not exist                                   | `404 Not Found`    |

### Audit log

Every successful deletion writes a `warn`-level log line from `AdminService`:

```
Admin 1 <admin@zenlot.com> hard-deleted user 42 <e2e+signup@zenlot.com> (journals=3, trades=2, refreshTokens=1, detachedJournals=0)
```

## Code map

| File                                                                 | Purpose                                        |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `src/admin/admin.module.ts`                                          | Module registered in `AppModule`               |
| `src/admin/admin.controller.ts`                                      | `GET /admin/users`, `DELETE /admin/users/:id`  |
| `src/admin/admin.service.ts`                                         | Lookup and transactional hard delete           |
| `src/admin/dto/*.ts`                                                 | Request validation                             |
| `src/auth/roles.constants.ts`                                        | `UserRole` enum, `DEFAULT_USER_ROLE`           |
| `src/auth/roles.decorator.ts`                                        | `@Roles(...)` metadata decorator               |
| `src/auth/roles.guard.ts`                                            | `RolesGuard` enforcing `@Roles`                |
| `src/custom_decorator/current-user.decorator.ts`                     | `@CurrentUser()` param decorator               |
| `scripts/promote-admin.sql`                                          | Promote an account to admin                    |
| `prisma/migrations/20261109090000_reset_client_assigned_admin_roles` | Reset pre-existing self-assigned `admin` roles |

## Tests

```bash
npx jest --testRegex='\.spec\.ts$' --testPathPattern='src/(admin|auth/roles|user/user\.service)'
```

- `src/admin/admin.service.spec.ts`: row lock, then step order inside the
  transaction, detaching other users' journals, the safeguards, the audit log,
  and that lookups never select the password.
- `src/admin/admin.controller.spec.ts`: drives the real `AuthGuard` →
  `RolesGuard` → `ValidationPipe` chain over HTTP on the Fastify adapter used
  in production (401 / 403 / 400 / 200).
- `src/auth/roles.guard.spec.ts`: guard behaviour in isolation.
- `src/user/user.service.spec.ts`: signup and profile update ignore `role`.

Note: `yarn test` uses `jest.config.js`, whose `testRegex` only matches
`*.e2e-spec.ts`, so unit specs must be run with the command above.
