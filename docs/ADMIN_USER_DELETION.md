# Admin: Immediate User Deletion

## Why this exists

Before a staging environment existed, end-to-end (e2e) test runs created real
accounts in the production database.

Self-service deletion (`DELETE /user/:id` or `DELETE /user/:id/initiate`) is a
**soft delete**: it sets `deletedAt`, schedules `deleteScheduledFor` 30 days
out, and queues a `permanent-deletion` job on the `deletion` queue. The user can
cancel within that grace period. There was no way to remove an account
immediately.

This feature gives an **admin** a way to delete a user **immediately and
permanently**, together with everything they own. It works on active users and
on users already in their grace period.

## Overview

| Method   | Path               | Who        | What it does                                                                                       |
| -------- | ------------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| `GET`    | `/admin/users`     | Admin only | Lists users (id, email, name, role, createdAt, deletedAt, deleteScheduledFor). Optional `?email=`. |
| `DELETE` | `/admin/users/:id` | Admin only | Hard-deletes the user (UUID) and all their data in one transaction.                                |

Both routes are protected by the global `AuthGuard` (valid `accesstoken`
header required) **and** by `RolesGuard` with `@Roles(UserRole.ADMIN)`. The
caller's role is read from the database on every request, so promoting or
demoting an admin takes effect immediately.

The routes are also listed in Swagger under the **Admin** tag at `/api/docs`.

## Becoming an admin

There is no API to grant the admin role. Signup always creates `trader`
accounts and profile updates cannot change `role`. An account is promoted
directly in the database:

```bash
psql "$DATABASE_URL" -v email='you@zenlot.com' -f scripts/promote-admin.sql
```

To demote, set `role` back to `'trader'`.

### Rollout

Older versions of signup and profile update stored whatever `role` the client
sent, so an existing row may already say `admin` without anyone having granted
it. The migration
`prisma/migrations/20261109090000_reset_client_assigned_admin_roles` resets
every `role = 'admin'` to `trader`. Deploy in this order:

1. Apply migrations (`yarn db:migrate:deploy`) **before or together with** the
   release that adds the `/admin` routes.
2. **After every old instance has stopped serving**, confirm no admins remain:
   `SELECT id, email FROM "user" WHERE role = 'admin';` should return no rows.
   If an instance that still accepted a client-supplied `role` wrote `admin`
   after the migration ran, re-run the migration's `UPDATE`.
3. Promote the trusted admin account(s) with `scripts/promote-admin.sql`.

## Finding the users to delete

```bash
curl -s "$API_URL/admin/users?email=e2e" \
  -H "accesstoken: $ADMIN_ACCESS_TOKEN"
```

`email` is a case-insensitive substring match. Password hashes are never
returned.

## Deleting a user

```bash
curl -s -X DELETE "$API_URL/admin/users/3f1c2a9e-5b7d-4c1e-9a2b-6d8e0f4a1b2c" \
  -H "accesstoken: $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirmEmail": "e2e+signup@zenlot.com"}'
```

Successful response (`200 OK`):

```json
{
  "id": "3f1c2a9e-5b7d-4c1e-9a2b-6d8e0f4a1b2c",
  "email": "e2e+signup@zenlot.com",
  "deleted": { "journals": 3, "trades": 2, "refreshTokens": 1, "feedback": 0 },
  "detachedJournals": 0
}
```

`deleted` counts the user's main records removed with them. `detachedJournals`
counts other users' journals that pointed at one of the deleted trades and were
kept (see below).

### What happens

In a single Prisma transaction (all-or-nothing):

1. The target `user` row is locked with `SELECT ... FOR UPDATE`, and the email
   confirmation and admin checks run against that locked row. A concurrent
   promotion or email change either finishes first, and the checks see it, or
   waits until the delete is done.
2. **Other** users' journals that link to one of the target's trades get
   `tradeId = NULL`. Without this step, the `journal.tradeId` cascade would
   delete them. Journal creation now rejects cross-user trade links, so this
   only affects older rows.
3. The `user` row is deleted. Every user-owned table (trades, journals, refresh
   tokens, push tokens, risk/drawdown state, trading plans, checklists,
   evaluations, reports, and so on) is removed by its `ON DELETE CASCADE`
   foreign key. `auditLog` rows are kept with `userId = NULL`. `feedback` has
   no foreign key to `user`, so the user's feedback rows (which include their
   email and message) are deleted explicitly just before the user row.

After the transaction commits:

- The user's live socket sessions are disconnected (their auth version is
  advanced). Their access tokens already stop working because the guard can
  no longer load the user.
- If the user had requested self-service deletion, the pending
  `deletion-<userId>` job is removed from the `deletion` queue.
- An `ADMIN_USER_HARD_DELETED` row is written to `auditLog`, attributed to the
  admin, with the deleted user's id, email and counts. `account_deleted` is
  tracked in analytics, and `AdminService` writes a `warn` log line.

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
| `:id` is not a UUID                                   | `400 Bad Request`  |
| User does not exist                                   | `404 Not Found`    |

## Code map

| File                                                                 | Purpose                                        |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| `src/admin/admin.module.ts`                                          | Module registered in `AppModule`               |
| `src/admin/admin.controller.ts`                                      | `GET /admin/users`, `DELETE /admin/users/:id`  |
| `src/admin/admin.service.ts`                                         | Lookup and transactional hard delete           |
| `src/admin/dto/*.ts`                                                 | Request validation                             |
| `src/auth/roles.constants.ts`                                        | `UserRole` enum                                |
| `src/auth/roles.decorator.ts`                                        | `@Roles(...)` metadata decorator               |
| `src/auth/roles.guard.ts`                                            | `RolesGuard` enforcing `@Roles`                |
| `scripts/promote-admin.sql`                                          | Promote an account to admin                    |
| `prisma/migrations/20261109090000_reset_client_assigned_admin_roles` | Reset pre-existing self-assigned `admin` roles |

## Tests

```bash
yarn test src/admin src/auth/roles.guard
```

- `src/admin/admin.service.spec.ts`: row lock first and user delete last,
  detaching other users' journals, socket revocation, removal of a pending
  scheduled-deletion job (and tolerance of its failure), the audit record, the
  safeguards, and that lookups never select the password.
- `src/admin/admin.controller.spec.ts`: drives the real `AuthGuard` →
  `RolesGuard` → `ValidationPipe` chain over HTTP on the Fastify adapter used
  in production (401 / 403 / 400 / 200).
- `src/auth/roles.guard.spec.ts`: guard behaviour in isolation.

Role handling on signup and profile update is covered by
`src/user/user.service.sanitization.spec.ts`.
