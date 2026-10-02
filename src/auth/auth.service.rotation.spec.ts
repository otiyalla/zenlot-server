/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { REFRESH_TOKEN_REUSE_GRACE_MS } from './auth.constants';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { SocketSessionRegistry } from './socket-session-registry.service';

// Behavioural tests for refresh-token rotation against an in-memory token
// table and real JWT signing. Transactions are serialised to model the user
// row lock that orders concurrent rotations in Postgres.

type Row = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  isRevoked: boolean;
  revokedAt: Date | null;
};

const user = {
  id: 'user-1',
  email: 'user@example.com',
  password: 'hashed',
  authVersion: 3,
};

const config: Record<string, string> = {
  JWT_SECRET: 'test-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  JWT_EXPIRES: '3600s',
  JWT_REFRESH_EXPIRES: '7d',
};

const hashed = (token: string) =>
  `sha256:${createHash('sha256').update(token).digest('hex')}`;

const matches = (row: Row, where: Record<string, any> = {}) =>
  Object.entries(where).every(([key, condition]) => {
    const value = row[key as keyof Row];
    if (condition && typeof condition === 'object' && 'gt' in condition) {
      return (value as Date) > condition.gt;
    }
    if (condition && typeof condition === 'object' && 'in' in condition) {
      return (condition.in as unknown[]).includes(value);
    }
    return value === condition;
  });

const createPrisma = () => {
  const rows: Row[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const prisma: any = {
    rows,
    user: {
      updateMany: jest.fn(async ({ where }: any) => ({
        count:
          where.id === user.id && where.authVersion === user.authVersion
            ? 1
            : 0,
      })),
    },
    refreshToken: {
      create: jest.fn(async ({ data }: any) => {
        const row: Row = {
          id: `rt-${rows.length + 1}`,
          createdAt: new Date(),
          isRevoked: false,
          revokedAt: null,
          ...data,
        };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) return null;
        return include?.user ? { ...row, user: { ...user } } : { ...row };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = rows.find((r) => matches(r, where));
        return row ? { ...row } : null;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = rows.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      }),
    },
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => {
      const run = queue.then(() => callback(prisma));
      queue = run.catch(() => undefined);
      return run;
    }),
  };
  return prisma;
};

describe('AuthService refresh-token rotation', () => {
  const jwt = new JwtService();
  const decodeToken = (publicToken: string) =>
    jwt.decode<{ token: string }>(publicToken).token;
  let prisma: any;
  let auditService: { log: jest.Mock };
  let service: AuthService;
  let now: number;

  const advance = (ms: number) => {
    now += ms;
    jest.setSystemTime(now);
  };

  beforeEach(() => {
    now = new Date('2026-10-01T12:00:00Z').getTime();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(now);
    prisma = createPrisma();
    auditService = { log: jest.fn() };
    service = new AuthService(
      jwt,
      {} as UserService,
      {} as EmailService,
      prisma as PrismaService,
      { get: (key: string) => config[key] } as unknown as ConfigService,
      {
        trackAuthFailed: jest.fn(),
        trackTokensRefreshed: jest.fn(),
        trackSessionVerified: jest.fn(),
        trackUserSignedOut: jest.fn(),
      } as unknown as AnalyticsService,
      auditService as unknown as AuditService,
      {} as SocketSessionRegistry,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const issue = () =>
    service.createRefreshToken({ email: user.email, sub: user.id });

  it('rotates a refresh token and records when the old one was revoked', async () => {
    const original = await issue();

    const { refreshToken: replacement } = await service.refreshTokens(original);

    expect(decodeToken(replacement)).not.toBe(decodeToken(original));
    const [oldRow, newRow] = prisma.rows;
    expect(oldRow).toMatchObject({ isRevoked: true, revokedAt: new Date(now) });
    expect(newRow).toMatchObject({
      token: hashed(decodeToken(replacement)),
      isRevoked: false,
    });
  });

  describe('hashed storage', () => {
    it('never stores the raw token value', async () => {
      const issued = await issue();

      const [row] = prisma.rows;
      expect(row.token).toBe(hashed(decodeToken(issued)));
      expect(
        prisma.rows.some((r: Row) => r.token === decodeToken(issued)),
      ).toBe(false);
    });

    it('still accepts a pre-hashing (plain) row and rotates it into a hashed one', async () => {
      const legacyRaw = 'a'.repeat(64);
      prisma.rows.push({
        id: 'legacy',
        token: legacyRaw,
        userId: user.id,
        expiresAt: new Date(now + 24 * 60 * 60 * 1000),
        createdAt: new Date(now - 60_000),
        isRevoked: false,
        revokedAt: null,
      });
      const legacyPublic = jwt.sign(
        { token: legacyRaw },
        { secret: config.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );

      const { refreshToken } = await service.refreshTokens(legacyPublic);

      expect(prisma.rows[0]).toMatchObject({ isRevoked: true });
      expect(prisma.rows[1].token).toBe(hashed(decodeToken(refreshToken)));
    });

    it('rejects a leaked stored hash presented as the token, even with the signing secret', async () => {
      await issue();
      const leakedHash = prisma.rows[0].token;
      const forged = jwt.sign(
        { token: leakedHash },
        { secret: config.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );

      await expect(service.refreshTokens(forged)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.rows[0].isRevoked).toBe(false);
    });
  });

  it('re-issues the same successor when a rotated token is replayed inside the grace window', async () => {
    const original = await issue();
    const first = await service.refreshTokens(original);

    // e.g. the first response was lost to a client timeout
    advance(10_000);
    const replay = await service.refreshTokens(original);

    expect(decodeToken(replay.refreshToken)).toBe(
      decodeToken(first.refreshToken),
    );
    expect(prisma.rows).toHaveLength(2);
    // The re-issued successor keeps working.
    await expect(
      service.refreshTokens(replay.refreshToken),
    ).resolves.toHaveProperty('accessToken');
  });

  it('gives two concurrent refreshes of the same token the same successor', async () => {
    const original = await issue();

    const [a, b] = await Promise.all([
      service.refreshTokens(original),
      service.refreshTokens(original),
    ]);

    expect(decodeToken(a.refreshToken)).toBe(decodeToken(b.refreshToken));
    expect(prisma.rows.filter((r: Row) => !r.isRevoked)).toHaveLength(1);
  });

  it('treats a replay after the grace window as reuse and revokes every session', async () => {
    const original = await issue();
    const { refreshToken: successor } = await service.refreshTokens(original);

    advance(REFRESH_TOKEN_REUSE_GRACE_MS + 1);
    await expect(service.refreshTokens(original)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.rows.every((r: Row) => r.isRevoked)).toBe(true);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        action: 'AUTH_REFRESH_REUSE_DETECTED',
      }),
    );
    // Whoever holds the successor is signed out too.
    await expect(service.refreshTokens(successor)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a grace-window replay once the successor itself was revoked, without a reuse alarm', async () => {
    const original = await issue();
    await service.refreshTokens(original);
    await service.signout(user.id);

    advance(5_000);
    await expect(service.refreshTokens(original)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auditService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_REFRESH_REUSE_DETECTED' }),
    );
  });

  it('rejects a token revoked without rotation (sign-out) without a reuse alarm', async () => {
    const original = await issue();
    await service.signout(user.id);

    advance(REFRESH_TOKEN_REUSE_GRACE_MS * 10);
    await expect(service.refreshTokens(original)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auditService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_REFRESH_REUSE_DETECTED' }),
    );
  });

  it('honours the grace window on the legacy /auth/verify refresh path too', async () => {
    const original = await issue();
    const first = (await service.verify('expired-access-token', original)) as {
      refreshToken: string;
    };

    advance(1_000);
    const replay = (await service.verify('expired-access-token', original)) as {
      refreshToken: string;
    };

    expect(decodeToken(replay.refreshToken)).toBe(
      decodeToken(first.refreshToken),
    );
  });
});
