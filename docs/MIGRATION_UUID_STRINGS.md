# Migration Guide: Foreign Keys to UUID Strings

## Overview

This migration converts all foreign key fields from `Int` to `String` to match UUID primary keys. The primary keys (`user.id`, `trade.id`, `journal.id`) are already UUID strings, but foreign keys were incorrectly typed as `Int`.

## Schema Changes

### Changed Fields

- `trade.userId`: `Int` → `String`
- `journal.userId`: `Int` → `String`
- `journal.tradeId`: `Int?` → `String?`
- `RefreshToken.userId`: `Int` → `String`

**Note**: `RefreshToken.id` remains as `@default(cuid())` and is unchanged.

## Database Migration Steps

### 1. Create Prisma Migration

After schema changes have been applied, create the migration:

```bash
npx prisma migrate dev --name convert_foreign_keys_to_uuid_strings
```

This will:

- Generate a migration SQL file
- Apply the migration to your database
- Regenerate Prisma Client

### 2. Regenerate Prisma Client

```bash
npx prisma generate
```

## Migration Strategy for Existing Data

⚠️ **IMPORTANT**: This migration requires careful handling if you have existing data.

### Scenario 1: Empty/Development Database

If your database is empty or in development:

1. The Prisma migration will handle everything automatically
2. No data migration script is needed
3. Simply run the migration commands above

### Scenario 2: Production Database with Existing Data

If you have existing data, you **MUST** perform data migration before applying the schema changes.

**Critical Issue**: The current database likely has `Int` foreign key values that cannot be directly converted to UUID strings. The primary keys are already UUIDs, so you need to map the existing integer values to their corresponding UUIDs.

#### Pre-Migration Data Backup

**Always backup your database first!**

```bash
# PostgreSQL example
pg_dump -h localhost -U your_user -d your_database > backup_before_uuid_migration.sql
```

#### Data Migration Strategy

Since primary keys are already UUIDs and foreign keys are integers, you need to:

1. **Identify the mapping** between integer foreign keys and UUID primary keys
   - This assumes there was a previous integer primary key system that was migrated to UUIDs
   - If this is not the case, you'll need to manually create the correct relationships

2. **Create a migration script** to update foreign keys:

```sql
-- Example migration script (ADJUST BASED ON YOUR ACTUAL DATA)
-- This assumes you have a mapping table or can derive the correct UUIDs

-- Update trade.userId
UPDATE trade
SET "userId" = (
  SELECT id::text
  FROM "user"
  WHERE -- Add your mapping logic here
)
WHERE "userId" IS NOT NULL;

-- Update journal.userId
UPDATE journal
SET "userId" = (
  SELECT id::text
  FROM "user"
  WHERE -- Add your mapping logic here
)
WHERE "userId" IS NOT NULL;

-- Update journal.tradeId
UPDATE journal
SET "tradeId" = (
  SELECT id::text
  FROM trade
  WHERE -- Add your mapping logic here
)
WHERE "tradeId" IS NOT NULL;

-- Update RefreshToken.userId
UPDATE "RefreshToken"
SET "userId" = (
  SELECT id::text
  FROM "user"
  WHERE -- Add your mapping logic here
)
WHERE "userId" IS NOT NULL;
```

3. **Alter column types** (after data is migrated):

```sql
-- Alter trade.userId
ALTER TABLE trade ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

-- Alter journal.userId
ALTER TABLE journal ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

-- Alter journal.tradeId
ALTER TABLE journal ALTER COLUMN "tradeId" TYPE TEXT USING "tradeId"::text;

-- Alter RefreshToken.userId
ALTER TABLE "RefreshToken" ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;
```

### 3. Test Migration

1. Test on a copy of your production database first
2. Verify all relationships are preserved
3. Run your application tests
4. Verify API endpoints work correctly

## Code Changes Summary

### Services Updated

- ✅ `UserService`: All `id` parameters changed from `number` to `string`
- ✅ `TradeService`: All `id` and `userId` parameters changed from `number` to `string`, removed `+userId` conversions
- ✅ `JournalService`: All `id` and `userId` parameters changed from `number` to `string`
- ✅ `AuthService`: JWT payload `sub` and `userId` parameters changed from `number` to `string`

### DTOs Updated

- ✅ All Trade DTOs: `userId` changed to `string` with `@IsUUID()` validator
- ✅ All Journal DTOs: `userId` and `tradeId` changed to `string` with `@IsUUID()` validator
- ✅ User DTOs: `id` and `userId` changed to `string` with `@IsUUID()` validator

### Controllers Updated

- ✅ All controllers: Removed `+id` and `+userId` string-to-number conversions
- ✅ Parameter types changed from `number` to `string`

### Interfaces Updated

- ✅ `AuthenticatedUser.id`: `number` → `string`
- ✅ `IJournal.id`, `userId`, `tradeId`: `number` → `string`

## Post-Migration Checklist

- [ ] Run `npx prisma generate` to regenerate Prisma Client
- [ ] Run application tests
- [ ] Verify API endpoints work correctly
- [ ] Check that frontend receives string IDs correctly (if applicable)
- [ ] Verify JWT tokens work correctly with string `sub` field
- [ ] Test authentication and authorization flows
- [ ] Verify refresh token functionality
- [ ] Check that all foreign key relationships are preserved

## Rollback Strategy

If you need to rollback:

1. **Restore from backup**:

   ```bash
   psql -h localhost -U your_user -d your_database < backup_before_uuid_migration.sql
   ```

2. **Or revert Prisma migration**:
   ```bash
   npx prisma migrate resolve --rolled-back <migration_name>
   ```

## Notes

- This migration is **breaking** - existing API clients expecting `number` IDs will need to be updated
- JWT tokens with `sub` as number will become invalid - users will need to re-authenticate
- Ensure all frontend code is updated to handle string UUIDs instead of numbers
