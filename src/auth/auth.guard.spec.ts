import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

function makeContext(opts: {
  isPublic: boolean;
  url: string;
  headers?: Record<string, string>;
}): ExecutionContext {
  const reflector = new Reflector();
  const request = {
    url: opts.url,
    headers: opts.headers ?? {},
    user: undefined as unknown,
  };
  const response = { setHeader: jest.fn() };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
    getType: jest.fn(),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('should be defined', () => {
    const authService = { verify: jest.fn() } as unknown as AuthService;
    const reflector = new Reflector();
    expect(new AuthGuard(authService, reflector)).toBeDefined();
  });

  it('does not call authService.verify for @Public() auth routes (prevents refresh-token double-consumption)', async () => {
    const verify = jest.fn().mockResolvedValue({ id: 'u1' });
    const authService = { verify } as unknown as AuthService;
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
  });
});
