import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function makeContext(opts: {
  isPublic: boolean;
  url: string;
  headers?: Record<string, string>;
}): ExecutionContext & {
  request: { user?: unknown };
  response: { setHeader: jest.Mock };
} {
  const request = {
    url: opts.url,
    headers: opts.headers ?? {},
    user: undefined as unknown,
  };
  const response = { setHeader: jest.fn() };
  return {
    request,
    response,
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
    getType: jest.fn(),
  } as unknown as ExecutionContext & {
    request: { user?: unknown };
    response: { setHeader: jest.Mock };
  };
}

const makeGuard = (isPublic: boolean) => {
  const authService = {
    verify: jest.fn(),
    verifyToken: jest.fn(),
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return {
    authService,
    guard: new AuthGuard(authService as unknown as AuthService, reflector),
  };
};

describe('AuthGuard', () => {
  it('should be defined', () => {
    const authService = { verify: jest.fn() } as unknown as AuthService;
    const reflector = new Reflector();
    expect(new AuthGuard(authService, reflector)).toBeDefined();
  });

  it('does not call authService.verify for @Public() auth routes (prevents refresh-token double-consumption)', async () => {
    const verify = jest.fn().mockResolvedValue({ id: 'u1' });
    const verifyToken = jest.fn().mockResolvedValue({ id: 'u1' });
    const authService = { verify, verifyToken } as unknown as AuthService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true), // isPublic = true
    } as unknown as Reflector;

    const guard = new AuthGuard(authService, reflector);
    const ctx = makeContext({
      isPublic: true,
      url: '/auth/verify',
      headers: {
        accesstoken: 'expired-token',
        refreshtoken: 'valid-refresh',
      },
    });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(verify).not.toHaveBeenCalled();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  describe('per-request verification', () => {
    it('authenticates protected requests with verifyToken, never the audited verify()', async () => {
      const { guard, authService } = makeGuard(false);
      const user = { id: 'u1', isAuthenticated: true };
      authService.verifyToken.mockResolvedValue(user);
      const ctx = makeContext({
        isPublic: false,
        url: '/trade',
        headers: { accesstoken: 'valid-token' },
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(authService.verifyToken).toHaveBeenCalledWith('valid-token');
      expect(authService.verify).not.toHaveBeenCalled();
      expect(ctx.request.user).toBe(user);
    });

    it('rejects a protected request whose access token is invalid', async () => {
      const { guard, authService } = makeGuard(false);
      authService.verifyToken.mockResolvedValue(null);
      const ctx = makeContext({
        isPublic: false,
        url: '/trade',
        headers: { accesstoken: 'expired-token' },
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(authService.verify).not.toHaveBeenCalled();
    });

    it('attaches the user on public routes via verifyToken and tolerates invalid tokens', async () => {
      const { guard, authService } = makeGuard(true);
      authService.verifyToken.mockResolvedValueOnce({ id: 'u1' });
      const valid = makeContext({
        isPublic: true,
        url: '/legal/terms',
        headers: { accesstoken: 'valid-token' },
      });
      await expect(guard.canActivate(valid)).resolves.toBe(true);
      expect(valid.request.user).toEqual({ id: 'u1' });

      authService.verifyToken.mockResolvedValueOnce(null);
      const invalid = makeContext({
        isPublic: true,
        url: '/legal/terms',
        headers: { accesstoken: 'expired-token' },
      });
      await expect(guard.canActivate(invalid)).resolves.toBe(true);
      expect(invalid.request.user).toBeUndefined();
      expect(authService.verify).not.toHaveBeenCalled();
    });
  });

  describe('no in-band refresh', () => {
    it('ignores refresh-token headers: never rotates or returns tokens in response headers', async () => {
      const { guard, authService } = makeGuard(false);
      authService.verifyToken.mockResolvedValue(null);
      const ctx = makeContext({
        isPublic: false,
        url: '/trade',
        headers: {
          accesstoken: 'expired-token',
          refreshtoken: 'valid-refresh',
          refresh_access_token: 'valid-refresh',
        },
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(authService.verifyToken).toHaveBeenCalledWith('expired-token');
      expect(authService.verify).not.toHaveBeenCalled();
      expect(ctx.response.setHeader).not.toHaveBeenCalled();
    });

    it('rejects a request that carries only a refresh token', async () => {
      const { guard, authService } = makeGuard(false);
      const ctx = makeContext({
        isPublic: false,
        url: '/trade',
        headers: { refreshtoken: 'valid-refresh' },
      });

      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        message: 'No tokens provided',
      });
      expect(authService.verifyToken).not.toHaveBeenCalled();
    });

    it('does not report routine invalid tokens to Sentry', async () => {
      const { guard, authService } = makeGuard(false);
      authService.verifyToken.mockResolvedValue(null);
      const ctx = makeContext({
        isPublic: false,
        url: '/trade',
        headers: { accesstoken: 'expired-token' },
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(Sentry.captureException).not.toHaveBeenCalled();
    });
  });
});
