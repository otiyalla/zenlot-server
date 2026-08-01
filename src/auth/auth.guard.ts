import {
  UnauthorizedException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { IncomingHttpHeaders } from 'http';
import * as Sentry from '@sentry/nestjs';
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
      headers: import('http').IncomingHttpHeaders;
      user?: unknown;
    }>();
    const tokens = this.extractTokenFromHeader(request);

    if (isPublic) {
      // Auth endpoints handle their own token operations (refresh, verify).
      // Running optional-auth here would rotate and revoke the refresh token
      // before the controller can use the same token from the request body.
      const url = (request as unknown as { url?: string }).url ?? '';
      if (url.startsWith('/auth/')) {
        return true;
      }

      // Optional authentication: if a token is present try to verify it and
      // attach req.user, but never block the request if absent or invalid.
      if (tokens?.token) {
        try {
          const result = (await this.authService.verify(
            tokens.token,
            tokens.refreshToken,
          )) as
            | (Record<string, unknown> & {
                accessToken?: string;
                refreshToken?: string;
              })
            | null;
          if (result) {
            request.user = result;
            if (
              result.accessToken &&
              result.refreshToken &&
              result.accessToken !== tokens.token
            ) {
              const response = context.switchToHttp().getResponse<{
                setHeader: (name: string, value: string) => void;
              }>();
              response.setHeader('new-access-token', result.accessToken);
              response.setHeader('new-refresh-token', result.refreshToken);
            }
          }
        } catch {
          // Token invalid or expired — proceed as unauthenticated.
        }
      }
      return true;
    }

    if (!tokens || (!tokens.token && !tokens.refreshToken)) {
      throw new UnauthorizedException('No tokens provided');
    }

    const { token, refreshToken } = tokens;
    try {
      const result = (await this.authService.verify(token, refreshToken)) as
        | (Record<string, unknown> & {
            accessToken?: string;
            refreshToken?: string;
          })
        | null;
      if (!result) {
        throw new UnauthorizedException('Invalid token');
      }

      // If new tokens were generated (refresh token was used), set them in response headers
      if (
        result.accessToken &&
        result.refreshToken &&
        result.accessToken !== token
      ) {
        const response = context.switchToHttp().getResponse<{
          setHeader: (name: string, value: string) => void;
        }>();
        response.setHeader('new-access-token', result.accessToken);
        response.setHeader('new-refresh-token', result.refreshToken);
      }

      request.user = result;
      return true;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { context: 'AuthGuard.canActivate' },
      });
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: {
    headers: IncomingHttpHeaders;
  }): { token: string; refreshToken: string } | undefined {
    const token = (request.headers['accesstoken'] ??
      request.headers['accesstoken']) as string | undefined;
    const refreshToken = (request.headers['refresh_access_token'] ??
      request.headers['refreshtoken']) as string | undefined;
    if (!token && !refreshToken) {
      return undefined;
    }
    return { token: token ?? '', refreshToken: refreshToken ?? '' };
  }
}
