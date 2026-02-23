import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

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
    isAuthenticated: true,
  };

  const configMock = {
    JWT_SECRET: 'test-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_EXPIRES: '3600s',
    JWT_REFRESH_EXPIRES: '7d',
  };

  beforeEach(async () => {
    jwtService = {
      sign: jest.fn(),
      verify: jest.fn(),
    } as unknown as JwtService;
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
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
      userService,
      emailService,
      prisma,
      configService,
      analytics,
      auditService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('signs in and returns tokens', async () => {
    userService.validateUser.mockResolvedValue(user);
    jest
      .spyOn(service as any, 'revokeAllRefreshTokens')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'createRefreshToken')
      .mockResolvedValue('refresh-token');
    (jwtService.sign as jest.Mock).mockReturnValue('access-token');

    const result = await service.signin(user.email, 'password');

    expect(userService.validateUser).toHaveBeenCalledWith(
      user.email,
      'password',
    );
    expect(jwtService.sign).toHaveBeenCalledWith(
      { email: user.email, sub: user.id },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: expect.objectContaining({
          email: user.email,
          isAuthenticated: true,
        }),
      }),
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

  it('verifies refresh token and returns user payload', async () => {
    (jwtService.verify as jest.Mock).mockReturnValue({
      token: 'db-refresh-token',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({
      token: 'db-refresh-token',
      user: { ...user, password: 'hashed' },
    });

    const result = await service.verifyRefreshToken('public-refresh-token');

    expect(jwtService.verify).toHaveBeenCalledWith('public-refresh-token', {
      secret: configMock.JWT_REFRESH_SECRET,
    });
    expect(result).toEqual({
      user: { ...user, password: undefined, isAuthenticated: true },
      token: 'db-refresh-token',
    });
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

    expect(jwtService.sign).toHaveBeenCalledWith(
      { email: 'user@example.com', sub: 'user-1' },
      expect.objectContaining({ secret: configMock.JWT_SECRET }),
    );
    expect(revokeSpy).toHaveBeenCalledWith('refresh-db-token');
    expect(result).toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'user@example.com',
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      }),
    );
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
