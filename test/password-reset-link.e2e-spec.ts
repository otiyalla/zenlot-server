import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { resolve } from 'path';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService, hashPasswordResetToken } from '../src/auth/auth.service';
import { SocketSessionRegistry } from '../src/auth/socket-session-registry.service';
import { UserService } from '../src/user/user.service';
import { UserGateway } from '../src/user/user.gateway';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';
import { AnalyticsService } from '../src/analytics/analytics.service';
import { AuditService } from '../src/audit/audit.service';

// expo-server-sdk is ESM-only; the e2e Jest config doesn't map it like the
// unit config does.
jest.mock('expo-server-sdk', () =>
  jest.requireActual<object>('./mocks/expo-server-sdk'),
);

/**
 * The whole emailed-link reset against a real PostgreSQL schema: request →
 * hashed token row → old password still valid → confirm → password changed,
 * sessions revoked, link spent. Needs a Postgres server the test may create a
 * throwaway database on:
 *
 *   PASSWORD_RESET_TEST_DATABASE_URL=postgresql://user:pw@localhost:5432/postgres \
 *     yarn test:e2e test/password-reset-link
 *
 * Skipped when the variable is unset (as in CI).
 */
const adminUrl = process.env.PASSWORD_RESET_TEST_DATABASE_URL;
const describeWithDatabase = adminUrl ? describe : describe.skip;

describeWithDatabase('Password reset link (e2e, PostgreSQL)', () => {
  const dbName = `zenlot_reset_e2e_${randomBytes(6).toString('hex')}`;
  let admin: Pool;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const sentLinks: { email: string; token: string }[] = [];
  const emailService = {
    sendPasswordResetLinkEmail: jest.fn(
      (email: string, token: string): Promise<boolean> => {
        sentLinks.push({ email, token });
        return Promise.resolve(true);
      },
    ),
  };
  const socketSessions = { advanceAuthVersion: jest.fn() };
  const noop = () => undefined;
  const userId = '7d0f5b9e-6a44-4f3b-9b8e-3c3c4f2f9a01';
  const email = 'jane@example.com';
  const oldPassword = 'old-password-1';

  const flush = () => new Promise((r) => setImmediate(r));
  const post = (url: string, payload: Record<string, string>) =>
    app.inject({ method: 'POST', url, payload });
  // The per-email cooldown would otherwise block a second request in a test.
  const clearResetCooldown = () =>
    app.get(AuthService)['lastPasswordResetAt'].clear();
  const requestLink = async () => {
    const res = await post('/auth/resetpassword', { email });
    await flush();
    return res;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${dbName}`;
    process.env.DATABASE_URL = url.toString();
    execFileSync(
      resolve(__dirname, '../node_modules/.bin/prisma'),
      ['migrate', 'deploy', '--config', 'prisma/prisma.config.ts'],
      {
        cwd: resolve(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString() },
        stdio: 'pipe',
      },
    );

    // Outside NODE_ENV=local, onModuleInit connects through Prisma Accelerate,
    // which a plain Postgres URL never answers. The client connects lazily.
    jest
      .spyOn(PrismaService.prototype, 'onModuleInit')
      .mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        UserService,
        PrismaService,
        JwtService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => ({ JWT_SECRET: 's' })[key] },
        },
        { provide: EmailService, useValue: emailService },
        { provide: SocketSessionRegistry, useValue: socketSessions },
        { provide: UserGateway, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: AnalyticsService,
          // Every track* method is a no-op. Not `then`: Nest would await the
          // provider as a thenable.
          useValue: new Proxy(
            {},
            { get: (_, key) => (key === 'then' ? undefined : noop) },
          ),
        },
        { provide: getQueueToken('deletion'), useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Same validation as src/main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = moduleRef.get(PrismaService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(async () => {
    sentLinks.length = 0;
    jest.clearAllMocks();
    clearResetCooldown();
    await prisma.passwordResetToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.create({
      data: {
        id: userId,
        fname: 'Jane',
        lname: 'Doe',
        email,
        role: 'trader',
        language: 'en',
        password: await bcrypt.hash(oldPassword, 4),
        accountCurrency: 'USD',
        rules: {},
      },
    });
    await prisma.refreshToken.create({
      data: {
        token: 'sha256:session',
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  });

  const currentUser = () =>
    prisma.user.findUniqueOrThrow({ where: { id: userId } });

  it('emails a link and changes nothing until it is used', async () => {
    const res = await requestLink();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('true');
    expect(sentLinks).toHaveLength(1);
    const [{ token }] = sentLinks;

    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    // Stored hashed, never raw.
    expect(rows[0].tokenHash).toBe(hashPasswordResetToken(token));
    expect(rows[0].usedAt).toBeNull();

    const user = await currentUser();
    expect(await bcrypt.compare(oldPassword, user.password)).toBe(true);
    expect(user.authVersion).toBe(0);
    const session = await prisma.refreshToken.findFirstOrThrow();
    expect(session.isRevoked).toBe(false);
  });

  it('answers an unknown email the same way, sending nothing', async () => {
    const res = await post('/auth/resetpassword', {
      email: 'nobody@example.com',
    });
    await flush();

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('true');
    expect(sentLinks).toHaveLength(0);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it('sets the new password, signs out every session and spends the link', async () => {
    await requestLink();
    const [{ token }] = sentLinks;

    const res = await post('/auth/resetpassword/confirm', {
      token,
      password: 'brand-new-password',
    });

    expect(res.statusCode).toBe(200);
    const user = await currentUser();
    expect(await bcrypt.compare('brand-new-password', user.password)).toBe(
      true,
    );
    expect(await bcrypt.compare(oldPassword, user.password)).toBe(false);
    expect(user.authVersion).toBe(1);
    const session = await prisma.refreshToken.findFirstOrThrow();
    expect(session.isRevoked).toBe(true);
    const row = await prisma.passwordResetToken.findFirstOrThrow();
    expect(row.usedAt).not.toBeNull();
    expect(socketSessions.advanceAuthVersion).toHaveBeenCalledWith(userId, 1);

    // Single use.
    const again = await post('/auth/resetpassword/confirm', {
      token,
      password: 'another-password',
    });
    expect(again.statusCode).toBe(400);
    expect(
      await bcrypt.compare(
        'brand-new-password',
        (await currentUser()).password,
      ),
    ).toBe(true);
  });

  it('honours a link redeemed twice at once only once', async () => {
    await requestLink();
    const [{ token }] = sentLinks;

    const results = await Promise.all(
      ['first-password-1', 'second-password-2'].map((password) =>
        post('/auth/resetpassword/confirm', { token, password }),
      ),
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect((await currentUser()).authVersion).toBe(1);
  });

  it('rejects an expired link', async () => {
    await requestLink();
    const [{ token }] = sentLinks;
    await prisma.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await post('/auth/resetpassword/confirm', {
      token,
      password: 'brand-new-password',
    });

    expect(res.statusCode).toBe(400);
    expect((await currentUser()).authVersion).toBe(0);
  });

  it('replaces an older link when a new one is requested', async () => {
    await requestLink();
    clearResetCooldown();
    await requestLink();
    const [{ token: first }, { token: second }] = sentLinks;

    const stale = await post('/auth/resetpassword/confirm', {
      token: first,
      password: 'brand-new-password',
    });
    expect(stale.statusCode).toBe(400);

    const fresh = await post('/auth/resetpassword/confirm', {
      token: second,
      password: 'brand-new-password',
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('spends an outstanding link when the password changes another way', async () => {
    await requestLink();
    const [{ token }] = sentLinks;
    await app.get(UserService).resetPassword(userId, 'changed-in-app-1');

    const res = await post('/auth/resetpassword/confirm', {
      token,
      password: 'brand-new-password',
    });

    expect(res.statusCode).toBe(400);
  });

  it('validates the new password before looking at the link', async () => {
    await requestLink();
    const [{ token }] = sentLinks;

    const res = await post('/auth/resetpassword/confirm', {
      token,
      password: 'short',
    });

    expect(res.statusCode).toBe(400);
    // The link is still usable.
    const row = await prisma.passwordResetToken.findFirstOrThrow();
    expect(row.usedAt).toBeNull();
  });
});
