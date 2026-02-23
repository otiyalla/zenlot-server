import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('AuthGuard', () => {
  it('should be defined', () => {
    const authService = {
      verify: jest.fn(),
    } as unknown as AuthService;
    const reflector = new Reflector();

    expect(new AuthGuard(authService, reflector)).toBeDefined();
  });
});
