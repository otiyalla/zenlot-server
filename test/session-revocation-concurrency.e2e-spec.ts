import { randomBytes } from 'crypto';
import { Pool } from 'pg';

const databaseUrl = process.env.SESSION_REVOCATION_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('Session revocation concurrency (PostgreSQL)', () => {
  const schemaName = `session_revocation_${randomBytes(8).toString('hex')}`;
  const schema = `"${schemaName}"`;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE ${schema}."user" (
        "id" TEXT PRIMARY KEY,
        "authVersion" INTEGER NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE ${schema}."RefreshToken" (
        "token" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "isRevoked" BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${schema}."RefreshToken", ${schema}."user"`);
    await pool.query(
      `INSERT INTO ${schema}."user" ("id", "authVersion") VALUES ($1, $2)`,
      ['user-1', 3],
    );
    await pool.query(
      `INSERT INTO ${schema}."RefreshToken" ("token", "userId") VALUES ($1, $2)`,
      ['old-token', 'user-1'],
    );
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it('fails rotation when password reset commits first', async () => {
    const resetClient = await pool.connect();
    const rotationClient = await pool.connect();
    let rotationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      rotationStarted = resolve;
    });
    let rotationSettled = false;

    try {
      await resetClient.query('BEGIN');
      await resetClient.query(
        `UPDATE ${schema}."user"
         SET "authVersion" = "authVersion" + 1
         WHERE "id" = $1`,
        ['user-1'],
      );

      const rotation = (async () => {
        await rotationClient.query('BEGIN');
        rotationStarted();
        const claim = await rotationClient.query(
          `UPDATE ${schema}."user"
           SET "authVersion" = $2
           WHERE "id" = $1 AND "authVersion" = $2
           RETURNING "id"`,
          ['user-1', 3],
        );
        if (claim.rowCount !== 1) {
          await rotationClient.query('ROLLBACK');
          return false;
        }
        await rotationClient.query(
          `UPDATE ${schema}."RefreshToken"
           SET "isRevoked" = TRUE
           WHERE "token" = $1 AND "isRevoked" = FALSE`,
          ['old-token'],
        );
        await rotationClient.query(
          `INSERT INTO ${schema}."RefreshToken" ("token", "userId")
           VALUES ($1, $2)`,
          ['replacement-token', 'user-1'],
        );
        await rotationClient.query('COMMIT');
        return true;
      })().finally(() => {
        rotationSettled = true;
      });

      await started;
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(rotationSettled).toBe(false);

      await resetClient.query(
        `UPDATE ${schema}."RefreshToken"
         SET "isRevoked" = TRUE
         WHERE "userId" = $1 AND "isRevoked" = FALSE`,
        ['user-1'],
      );
      await resetClient.query('COMMIT');

      await expect(rotation).resolves.toBe(false);
      const tokens = await pool.query<{ token: string; isRevoked: boolean }>(
        `SELECT "token", "isRevoked"
         FROM ${schema}."RefreshToken"
         ORDER BY "token"`,
      );
      expect(tokens.rows).toEqual([{ token: 'old-token', isRevoked: true }]);
    } finally {
      await Promise.allSettled([
        resetClient.query('ROLLBACK'),
        rotationClient.query('ROLLBACK'),
      ]);
      resetClient.release();
      rotationClient.release();
    }
  });

  it('makes password reset revoke the replacement when rotation commits first', async () => {
    const rotationClient = await pool.connect();
    const resetClient = await pool.connect();
    let resetStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resetStarted = resolve;
    });
    let resetSettled = false;

    try {
      await rotationClient.query('BEGIN');
      const claim = await rotationClient.query(
        `UPDATE ${schema}."user"
         SET "authVersion" = $2
         WHERE "id" = $1 AND "authVersion" = $2
         RETURNING "id"`,
        ['user-1', 3],
      );
      expect(claim.rowCount).toBe(1);
      await rotationClient.query(
        `UPDATE ${schema}."RefreshToken"
         SET "isRevoked" = TRUE
         WHERE "token" = $1 AND "isRevoked" = FALSE`,
        ['old-token'],
      );
      await rotationClient.query(
        `INSERT INTO ${schema}."RefreshToken" ("token", "userId")
         VALUES ($1, $2)`,
        ['replacement-token', 'user-1'],
      );

      const reset = (async () => {
        await resetClient.query('BEGIN');
        resetStarted();
        await resetClient.query(
          `UPDATE ${schema}."user"
           SET "authVersion" = "authVersion" + 1
           WHERE "id" = $1`,
          ['user-1'],
        );
        await resetClient.query(
          `UPDATE ${schema}."RefreshToken"
           SET "isRevoked" = TRUE
           WHERE "userId" = $1 AND "isRevoked" = FALSE`,
          ['user-1'],
        );
        await resetClient.query('COMMIT');
      })().finally(() => {
        resetSettled = true;
      });

      await started;
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(resetSettled).toBe(false);

      await rotationClient.query('COMMIT');
      await reset;

      const state = await pool.query<{
        authVersion: number;
        token: string;
        isRevoked: boolean;
      }>(
        `SELECT u."authVersion", r."token", r."isRevoked"
         FROM ${schema}."user" u
         JOIN ${schema}."RefreshToken" r ON r."userId" = u."id"
         WHERE u."id" = $1
         ORDER BY r."token"`,
        ['user-1'],
      );
      expect(state.rows).toEqual([
        { authVersion: 4, token: 'old-token', isRevoked: true },
        { authVersion: 4, token: 'replacement-token', isRevoked: true },
      ]);
    } finally {
      await Promise.allSettled([
        rotationClient.query('ROLLBACK'),
        resetClient.query('ROLLBACK'),
      ]);
      rotationClient.release();
      resetClient.release();
    }
  });
});
