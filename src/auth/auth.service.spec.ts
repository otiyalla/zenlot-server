/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { AuthService } from './auth.service';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { SocketSessionRegistry } from './socket-session-registry.service';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const hashed = (token: string) =>
  `sha256:${crypto.createHash('sha256').update(token).digest('hex')}`;

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let prisma: any;
  let userService: any;
  let emailService: any;
  let analytics: any;
  let auditService: any;
  let socketSessions: any;

  const user = {
    id: 'user-1',
    email: 'user@example.com',
    password: 'hashed',
    authVersion: 3,
    isAuthenticated: true,
  };

  const configMock = {
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_EXPIRES: '3600s',
    JWT_REFRESH_EXPIRES: '7d',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
      decode: jest.fn(() => ({
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      })),
    } as unknown as JwtService;
    prisma = {
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(prisma)),
    };
    userService = {
      validateUser: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      resetPassword: jest.fn(),
    };
    emailService = {
      sendPasswordResentEmail: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key in configMock)
          return configMock[key as keyof typeof configMock];
        return undefined;
      }),
    } as unknown as ConfigService;

    analytics = {
      trackAuthFailed: jest.fn(),
      trackUserSignedIn: jest.fn(),
      trackTokensRefreshed: jest.fn(),
      trackSessionVerified: jest.fn(),
      trackPasswordReset: jest.fn(),
      trackPasswordResetRequested: jest.fn(),
      trackUserSignedOut: jest.fn(),
    };

    auditService = {
      log: jest.fn(),
    };
    socketSessions = {
      advanceAuthVersion: jest.fn(),
    };

    service = new AuthService(
      jwtService,
      userService as unknown as UserService,
      emailService as unknown as EmailService,
      prisma as unknown as PrismaService,
      configService,
      analytics as unknown as AnalyticsService,
      auditService as unknown as AuditService,
      socketSessions as unknown as SocketSessionRegistry,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('signs in and returns tokens', async () => {
    userService.validateUser.mockResolvedValue(user);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('refresh-token');
    (jwtService.sign as jest.Mock).mockReturnValue('access-token');

    const result = await service.signin(user.email, 'password');

    expect(userService.validateUser).toHaveBeenCalledWith(
      user.email,
      'password',
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, authVersion: user.authVersion },
      data: { authVersion: { increment: 1 } },
    });
    expect(socketSessions.advanceAuthVersion).toHaveBeenCalledWith(
      user.id,
      user.authVersion + 1,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion + 1,
      },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        user: expect.objectContaining({
          email: user.email,
          isAuthenticated: true,
        }),
      }),
    );
  });

  it('signs up with the initial auth version in the access token', async () => {
    userService.create.mockResolvedValue(user);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('refresh-token');
    (jwtService.sign as jest.Mock).mockReturnValue('access-token');

    await service.signup({ email: user.email } as any);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion,
      },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
  });

  it('creates a refresh token and stores it', async () => {
    const randomSpy = jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(
        () => Buffer.from('a'.repeat(32)) as unknown as Buffer,
      );
    (jwtService.sign as jest.Mock).mockReturnValue('public-refresh-token');
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });

    const result = await service.createRefreshToken({
      email: user.email,
      sub: user.id,
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        token:
          '6161616161616161616161616161616161616161616161616161616161616161',
      },
      expect.objectContaining({ secret: configMock.JWT_REFRESH_SECRET }),
    );
    // Only the hash is stored; the raw value lives solely inside the JWT.
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.id,
          token: hashed(
            '6161616161616161616161616161616161616161616161616161616161616161',
          ),
        }),
      }),
    );
    expect(result).toBe('public-refresh-token');
    randomSpy.mockRestore();
  });

  it('surfaces a database fault (not a 401) when a refresh token cannot be persisted', async () => {
    const randomSpy = jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(
        () => Buffer.from('b'.repeat(32)) as unknown as Buffer,
      );
    (jwtService.sign as jest.Mock).mockReturnValue('public-refresh-token');
    const dbError = new Error('db unavailable');
    prisma.refreshToken.create.mockRejectedValue(dbError);

    await expect(
      service.createRefreshToken({
        email: user.email,
        sub: user.id,
      }),
    ).rejects.toBe(dbError);
    randomSpy.mockRestore();
  });

  it('verifies refresh token and returns user payload', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      token: 'db-refresh-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({
      token: 'db-refresh-token',
      isRevoked: false,
      revokedAt: null,
      user: { ...user, password: 'hashed' },
    });

    const result = await service.verifyRefreshToken('public-refresh-token');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.verify).toHaveBeenCalledWith('public-refresh-token', {
      secret: configMock.JWT_REFRESH_SECRET,
    });

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          token: { in: [hashed('db-refresh-token'), 'db-refresh-token'] },
          expiresAt: { gt: expect.any(Date) },
        },
      }),
    );
    expect(result).toEqual({
      user: { ...user, password: undefined, isAuthenticated: true },
      token: 'db-refresh-token',
      isRevoked: false,
      revokedAt: null,
    });
  });

  it('rejects an access token after the user auth version changes', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      email: user.email,
      sub: user.id,
      authVersion: user.authVersion - 1,
    });
    userService.findByEmail.mockResolvedValue(user);

    await expect(service.verifyToken('old-access-token')).resolves.toBeNull();
  });

  it('rejects a legacy access token without an auth version', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      email: user.email,
      sub: user.id,
    });

    await expect(
      service.verifyToken('legacy-access-token'),
    ).resolves.toBeNull();
    expect(userService.findByEmail).not.toHaveBeenCalled();
  });

  it('rejects unknown or expired refresh tokens', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      token: 'unknown-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue(null);

    await expect(
      service.verifyRefreshToken('public-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails sign-in when existing session revocation is unavailable', async () => {
    userService.validateUser.mockResolvedValue(user);
    const revocationError = new Error('refresh-token database unavailable');
    prisma.refreshToken.updateMany.mockRejectedValue(revocationError);
    const createRefreshToken = jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('unused');

    await expect(service.signin(user.email, 'password')).rejects.toBe(
      revocationError,
    );
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('does not sign in when a password reset wins the credential claim', async () => {
    userService.validateUser.mockResolvedValue(user);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    const createRefreshToken = jest.spyOn(service, 'createRefreshToken');

    await expect(
      service.signin(user.email, 'old-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('surfaces a database fault (not a 401) from verify when revocation is unavailable', async () => {
    jest.spyOn(service, 'verifyToken').mockResolvedValue(null);
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('new-refresh-token');
    const revocationError = new Error('refresh-token database unavailable');
    jest
      .spyOn(service as any, 'revokeRefreshToken')
      .mockRejectedValue(revocationError);

    await expect(
      service.verify('expired-access-token', 'valid-refresh-token'),
    ).rejects.toBe(revocationError);
    expect(auditService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_VERIFY_FAILED' }),
    );
  });

  it('fails sign-out when session revocation is unavailable', async () => {
    const revocationError = new Error('refresh-token database unavailable');
    jest
      .spyOn(service as any, 'revokeAllRefreshTokens')
      .mockRejectedValue(revocationError);

    await expect(service.signout(user.id)).rejects.toBe(revocationError);
    expect(analytics.trackUserSignedOut).not.toHaveBeenCalled();
    expect(analytics.trackAuthFailed).toHaveBeenCalledWith(
      user.id,
      'signout',
      'server_error',
    );
  });

  it('does not mint a replacement token when refresh revocation fails', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    const revocationError = new Error('refresh-token database unavailable');
    const revoke = jest
      .spyOn(service as any, 'revokeRefreshToken')
      .mockRejectedValue(revocationError);
    const createRefreshToken = jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('must-not-be-created');

    // A server fault must not look like a rejected session (401): the client
    // keeps the still-valid refresh token and retries.
    await expect(service.refreshTokens('old-public-token')).rejects.toBe(
      revocationError,
    );
    expect(revoke).toHaveBeenCalledWith('old-db-token', prisma);
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('returns the verified payload when the access token is valid', async () => {
    const payload = { id: 'user-1', email: 'user@example.com' };
    jest.spyOn(service, 'verifyToken').mockResolvedValue(payload as any);

    const result = await service.verify('valid-access-token');

    expect(result).toBe(payload);
  });

  it('rejects an invalid access token with a 401 when no refresh token is supplied', async () => {
    jest.spyOn(service, 'verifyToken').mockResolvedValue(null);
    const verifyRefreshToken = jest.spyOn(service, 'verifyRefreshToken');

    await expect(service.verify('expired-access-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verifyRefreshToken).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUTH_VERIFY_FAILED' }),
    );
  });

  it('treats an empty refresh token like a missing one', async () => {
    jest.spyOn(service, 'verifyToken').mockResolvedValue(null);

    await expect(
      service.verify('expired-access-token', ''),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refreshes tokens when the access token is invalid and refresh token is valid', async () => {
    jest.spyOn(service, 'verifyToken').mockResolvedValue(null);
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'refresh-db-token' } as any);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('new-refresh-token');

    const revokeSpy = jest
      .spyOn(service as any, 'revokeRefreshToken')
      .mockResolvedValue(true);

    (jwtService.sign as jest.Mock).mockReturnValue('new-access-token');

    const result = await service.verify(
      'expired-access-token',
      'valid-refresh-token',
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        email: 'user@example.com',
        sub: 'user-1',
        authVersion: user.authVersion,
      },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, authVersion: user.authVersion },
      data: { authVersion: user.authVersion },
    });
    expect(revokeSpy).toHaveBeenCalledWith('refresh-db-token', prisma);
    expect(prisma.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      revokeSpy.mock.invocationCallOrder[0],
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'user@example.com',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      }),
    );
  });

  it("returns the concurrent winner's successor instead of minting a second one", async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    // The winner revoked it moments ago.
    prisma.refreshToken.findFirst.mockResolvedValue({ revokedAt: new Date() });
    prisma.refreshToken.findUnique.mockResolvedValue({
      isRevoked: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    (jwtService.sign as jest.Mock).mockImplementation((claims: any) =>
      claims.token ? `public:${claims.token}` : 'new-access-token',
    );
    const createRefreshToken = jest.spyOn(service, 'createRefreshToken');

    const result = await service.refreshTokens('old-public-token');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        token: { in: [hashed('old-db-token'), 'old-db-token'] },
        isRevoked: false,
      },
      data: { isRevoked: true, revokedAt: expect.any(Date) },
    });
    expect(createRefreshToken).not.toHaveBeenCalled();
    const successor = crypto
      .createHmac('sha256', configMock.JWT_REFRESH_SECRET)
      .update('rotate:old-db-token')
      .digest('hex');
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { token: hashed(successor) },
    });
    expect(result.refreshToken).toBe(`public:${successor}`);
  });

  it('rejects a concurrently claimed token whose successor is gone', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(
      service.refreshTokens('old-public-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('includes the current auth version in dedicated refresh access tokens', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    jest.spyOn(service as any, 'revokeRefreshToken').mockResolvedValue(true);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('new-refresh-token');
    (jwtService.sign as jest.Mock).mockReturnValue('new-access-token');

    await service.refreshTokens('old-public-token');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.sign).toHaveBeenCalledWith(
      {
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion,
      },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
  });

  it('does not rotate after password reset changes the auth version', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    const revoke = jest.spyOn(service as any, 'revokeRefreshToken');
    const createRefreshToken = jest.spyOn(service, 'createRefreshToken');

    await expect(
      service.refreshTokens('old-public-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, authVersion: user.authVersion },
      data: { authVersion: user.authVersion },
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  describe('refresh failure classification', () => {
    it('rejects a malformed or expired refresh JWT with a 401', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new TokenExpiredError('jwt expired', new Date());
      });

      await expect(
        service.refreshTokens('expired-public-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.refreshToken.findFirst).not.toHaveBeenCalled();
    });

    it('surfaces a database fault during the refresh-token lookup as a server error', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ token: 'db-token' });
      const dbError = new Error('connection refused');
      prisma.refreshToken.findFirst.mockRejectedValue(dbError);

      await expect(service.refreshTokens('public-token')).rejects.toBe(dbError);
      expect(auditService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_REFRESH_FAILED' }),
      );
    });

    it('still rejects a revoked refresh token with a 401', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ token: 'db-token' });
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshTokens('public-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_REFRESH_FAILED' }),
      );
    });
  });

  describe('refresh-token expiry', () => {
    const DAY = 24 * 60 * 60;

    it.each([
      ['7d', 7 * DAY],
      ['1w', 7 * DAY],
      ['7 days', 7 * DAY],
      ['12h', 12 * 60 * 60],
      ['3600s', 3600],
    ])(
      'stores the expiry the JWT carries for JWT_REFRESH_EXPIRES=%s',
      async (value, expectedSeconds) => {
        const realJwt = new JwtService();
        const svc = new AuthService(
          realJwt,
          userService as unknown as UserService,
          emailService as unknown as EmailService,
          prisma as unknown as PrismaService,
          {
            get: (key: string) =>
              key === 'JWT_REFRESH_EXPIRES'
                ? value
                : configMock[key as keyof typeof configMock],
          } as unknown as ConfigService,
          analytics as unknown as AnalyticsService,
          auditService as unknown as AuditService,
          socketSessions as unknown as SocketSessionRegistry,
        );
        const issuedAt = Date.now() / 1000;

        const publicToken = await svc.createRefreshToken({
          email: user.email,
          sub: user.id,
        });

        const { exp } = realJwt.decode<{ exp: number }>(publicToken);
        const { expiresAt } = prisma.refreshToken.create.mock.calls[0][0].data;
        expect(expiresAt.getTime()).toBe(exp * 1000);
        expect(Math.abs(exp - (issuedAt + expectedSeconds))).toBeLessThan(5);
      },
    );
  });

  describe('Sentry noise', () => {
    it('does not report routine expired access tokens', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new TokenExpiredError('jwt expired', new Date());
      });

      await expect(service.verifyToken('expired')).resolves.toBeNull();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('does not report a token whose auth version is stale', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion - 1,
      });
      userService.findByEmail.mockResolvedValue(user);

      await expect(service.verifyToken('stale')).resolves.toBeNull();
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('reports and propagates unexpected failures while verifying an access token (5xx, not 401)', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion,
      });
      const dbError = new Error('db down');
      userService.findByEmail.mockRejectedValue(dbError);

      await expect(service.verifyToken('valid')).rejects.toBe(dbError);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      // /auth/verify surfaces it as a server error, not an invalid token.
      await expect(service.verify('valid')).rejects.toBe(dbError);
      expect(auditService.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTH_VERIFY_FAILED' }),
      );
    });

    it('does not report a rejected refresh token', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ token: 'db-token' });
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshTokens('public-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });

  it('resetPassword passes user language to sendPasswordResentEmail', async () => {
    userService.findByEmail.mockResolvedValue({
      id: user.id,
      email: user.email,
      fname: 'Jane',
      language: 'fr',
    });
    userService.resetPassword.mockResolvedValue({ id: user.id });
    emailService.sendPasswordResentEmail.mockResolvedValue(true);

    const result = await service.resetPassword(user.email);

    expect(result).toBe(true);

    expect(emailService.sendPasswordResentEmail).toHaveBeenCalledWith(
      user.email,
      expect.stringMatching(/^tPass/),
      'Jane',
      'fr',
    );
  });
});
