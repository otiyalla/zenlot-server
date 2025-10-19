import { UnauthorizedException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { jwtConstants } from './auth.constants';
import { AuthService } from './auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../custom_decorator/public.decorator'; // Adjust the import path as necessary

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService, 
    private readonly authService: AuthService,
    private reflector: Reflector
  ) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

      if (isPublic) {
      return true;
    }
    
    const request = context.switchToHttp().getRequest();
    const tokens = this.extractTokenFromHeader(request);
 
    if (!tokens || (!tokens.token && !tokens.refresh_token)) {
      throw new UnauthorizedException('No tokens provided');
    }
    
    const { token, refresh_token } = tokens;
    try {
      const result = await this.authService.verify(token, refresh_token);
      if (!result) {
        throw new UnauthorizedException('Invalid token');
      }
      
      // If new tokens were generated (refresh token was used), set them in response headers
      if ((result as any).access_token && (result as any).refresh_token && (result as any).access_token !== token) {
        const response = context.switchToHttp().getResponse();
        response.setHeader('new-access-token', (result as any).access_token);
        response.setHeader('new-refresh-token', (result as any).refresh_token);
      }
      
      request.user = result;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: any): {token: string, refresh_token: string} | undefined {
    const token = request.headers['access_token'];
    const refresh_token = request.headers['refresh_access_token'];
    if (!token && !refresh_token) {
      return undefined;
    }
    return {token, refresh_token}; ;
  }
}
