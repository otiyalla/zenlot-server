import {
  UnauthorizedException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { IncomingHttpHeaders } from 'http';
import { AuthService } from './auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../custom_decorator/public.decorator'; // Adjust the import path as necessary

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      headers: IncomingHttpHeaders;
      url?: string;
      user?: unknown;
    }>();
    const token = this.extractAccessToken(request);

    if (isPublic) {
      // Auth endpoints handle their own token operations (refresh, verify).
      if ((request.url ?? '').startsWith('/auth/')) {
        return true;
      }

      // Optional authentication: if a valid token is present attach req.user,
      // but never block the request if absent or invalid.
      if (token) {
        const user = await this.authService.verifyToken(token);
        if (user) request.user = user;
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('No tokens provided');
    }

    // verifyToken, not verify(): this runs on every request, and verify() is
    // the /auth/verify endpoint's logic (audit row + analytics per call). It
    // never rotates refresh tokens: refreshing is only POST /auth/refresh.
    const user = await this.authService.verifyToken(token);
    if (!user) {
      // Routine (expired token), so no Sentry event.
      throw new UnauthorizedException('Invalid token');
    }
    request.user = user;
    return true;
  }

  private extractAccessToken(request: {
    headers: IncomingHttpHeaders;
  }): string | undefined {
    const header = request.headers['accesstoken'];
    return (Array.isArray(header) ? header[0] : header) || undefined;
  }
}
