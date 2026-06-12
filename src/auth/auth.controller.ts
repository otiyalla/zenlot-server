import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../custom_decorator/public.decorator'; // Adjust the import path as necessary
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * @swagger
   * tags:
   *   name: Auth
   *   description: Authentication management
   */

  @Post('signin')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiResponse({ status: 200, description: 'Sign in successful.' })
  async signin(
    @Body() body: { email: string; password: string },
    @Request() req: any,
  ) {
    const { email, password } = body;
    return this.authService.signin(
      email,
      password,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Token verification successful.' })
  async verify(
    @Body() body: { token: string; refreshToken: string },
    @Request() req: any,
  ) {
    const { token, refreshToken } = body;
    return this.authService.verify(
      token,
      refreshToken,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully.' })
  async refresh(@Body() body: { refreshToken: string }, @Request() req: any) {
    const { refreshToken } = body;
    return this.authService.refreshTokens(
      refreshToken,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out and revoke tokens' })
  @ApiResponse({ status: 200, description: 'Signed out successfully.' })
  async signout(@Request() req: any) {
    const userId = req.user.id;
    return this.authService.signout(userId, req.ip, req.headers['user-agent']);
  }

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiResponse({ status: 201, description: 'User signed up successfully.' })
  async signup(@Body() body: any, @Request() req: any) {
    return this.authService.signup(body, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Post('resetpassword')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with email' })
  @ApiResponse({ status: 200, description: 'Password reset initiated.' })
  async resetPassword(@Body() body: { email: string }, @Request() req: any) {
    const email = body.email;
    return this.authService.resetPassword(
      email,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('forgotpassword')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send forgot password email' })
  @ApiResponse({ status: 200, description: 'Password recovery email sent.' })
  async forgotPassword(@Body() body: { email: string }, @Request() req: any) {
    const { email } = body;
    return this.authService.forgotPassword(
      email,
      req.ip,
      req.headers['user-agent'],
    );
  }
}
