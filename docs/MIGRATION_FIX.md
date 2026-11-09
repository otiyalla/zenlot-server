# Fix for accountCurrency Migration Error

## Problem

You're trying to add a required `accountCurrency` field to the `trade` table, but there's existing data (1 row) without a value for this field.

## Solution

### Step 1: Fix permissions (if needed)

```bash
sudo chown -R $(whoami) prisma/migrations
```

### Step 2: Temporarily make field optional in schema

In `prisma/schema.prisma`, change line 27 from:

```prisma
accountCurrency    String
```

to:

```prisma
accountCurrency    String?
```

### Step 3: Create migration with --create-only

```bash
yarn prisma migrate dev --create-only --name add_account_currency_to_trade
```

### Step 4: Edit the migration file

Find the migration file in `prisma/migrations/[timestamp]_add_account_currency_to_trade/migration.sql`

Replace its contents with:

```sql
-- Add column as nullable first
ALTER TABLE "trade" ADD COLUMN "accountCurrency" TEXT;

-- Update existing rows with accountCurrency from related user
UPDATE "trade" SET "accountCurrency" = "user"."accountCurrency"
FROM "user" WHERE "trade"."userId" = "user"."id";

-- Make column required
ALTER TABLE "trade" ALTER COLUMN "accountCurrency" SET NOT NULL;
```

### Step 5: Update schema back to required

In `prisma/schema.prisma`, change line 27 back to:

```prisma
accountCurrency    String
```

### Step 6: Apply the migration

```bash
yarn prisma migrate dev
```

This will apply the migration and Prisma will detect that the schema matches the migration.
