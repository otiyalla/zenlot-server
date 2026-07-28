/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let prisma: any;
  let userService: any;
  let emailService: any;
  let analytics: any;
  let auditService: any;

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
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    } as unknown as JwtService;
    prisma = {
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
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

    service = new AuthService(
      jwtService,
      userService as unknown as UserService,
      emailService as unknown as EmailService,
      prisma as unknown as PrismaService,
      configService,
      analytics as unknown as AnalyticsService,
      auditService as unknown as AuditService,
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
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.id,
          token:
            '6161616161616161616161616161616161616161616161616161616161616161',
        }),
      }),
    );
    expect(result).toBe('public-refresh-token');
    randomSpy.mockRestore();
  });

  it('throws when refresh token cannot be persisted', async () => {
    const randomSpy = jest
      .spyOn(crypto, 'randomBytes')
      .mockImplementation(
        () => Buffer.from('b'.repeat(32)) as unknown as Buffer,
      );
    (jwtService.sign as jest.Mock).mockReturnValue('public-refresh-token');
    prisma.refreshToken.create.mockRejectedValue(new Error('db unavailable'));

    await expect(
      service.createRefreshToken({
        email: user.email,
        sub: user.id,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    randomSpy.mockRestore();
  });

  it('verifies refresh token and returns user payload', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      token: 'db-refresh-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({
      token: 'db-refresh-token',
      user: { ...user, password: 'hashed' },
    });

    const result = await service.verifyRefreshToken('public-refresh-token');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(jwtService.verify).toHaveBeenCalledWith('public-refresh-token', {
      secret: configMock.JWT_REFRESH_SECRET,
    });

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          token: 'db-refresh-token',
          isRevoked: false,
        }),
      }),
    );
    expect(result).toEqual({
      user: { ...user, password: undefined, isAuthenticated: true },
      token: 'db-refresh-token',
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

  it('rejects revoked refresh tokens', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      token: 'revoked-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue(null);

    await expect(
      service.verifyRefreshToken('public-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          token: 'revoked-token',
          isRevoked: false,
        }),
      }),
    );
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

  it('fails refresh rotation when old-token revocation is unavailable', async () => {
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
    ).rejects.toBeInstanceOf(UnauthorizedException);
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
    const revoke = jest
      .spyOn(service as any, 'revokeRefreshToken')
      .mockRejectedValue(new Error('refresh-token database unavailable'));
    const createRefreshToken = jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('must-not-be-created');

    await expect(
      service.refreshTokens('old-public-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(revoke).toHaveBeenCalledWith('old-db-token', prisma);
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('returns the verified payload when the access token is valid', async () => {
    const payload = { id: 'user-1', email: 'user@example.com' };
    jest.spyOn(service, 'verifyToken').mockResolvedValue(payload as any);

    const result = await service.verify('valid-access-token');

    expect(result).toBe(payload);
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
      .mockResolvedValue(undefined);

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

  it('does not rotate a refresh token already claimed concurrently', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    const createRefreshToken = jest.spyOn(service, 'createRefreshToken');

    await expect(
      service.refreshTokens('old-public-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'old-db-token', isRevoked: false },
      data: { isRevoked: true },
    });
    expect(createRefreshToken).not.toHaveBeenCalled();
  });

  it('includes the current auth version in dedicated refresh access tokens', async () => {
    jest
      .spyOn(service, 'verifyRefreshToken')
      .mockResolvedValue({ user, token: 'old-db-token' } as any);
    jest
      .spyOn(service as any, 'revokeRefreshToken')
      .mockResolvedValue(undefined);
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
