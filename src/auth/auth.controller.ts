import { Body, Controller, Post, Request } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Verify access and refresh tokens' })
  @ApiResponse({ status: 200, description: 'Token verification successful.' })
  async verify(
    @Body() body: { token: string; refresh_token: string },
    @Request() req: any,
  ) {
    const { token, refresh_token } = body;
    return this.authService.verify(
      token,
      refresh_token,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully.' })
  async refresh(@Body() body: { refresh_token: string }, @Request() req: any) {
    const { refresh_token } = body;
    return this.authService.refreshTokens(
      refresh_token,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('signout')
  @ApiOperation({ summary: 'Sign out and revoke tokens' })
  @ApiResponse({ status: 200, description: 'Signed out successfully.' })
  async signout(@Body() body: { userId: string }, @Request() req: any) {
    const { userId } = body;
    return this.authService.signout(userId, req.ip, req.headers['user-agent']);
  }

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiResponse({ status: 201, description: 'User signed up successfully.' })
  async signup(@Body() body: any, @Request() req: any) {
    return this.authService.signup(body, req.ip, req.headers['user-agent']);
  }

  @Post('resetpassword')
  @Public()
  @ApiOperation({ summary: 'Reset password with email' })
  @ApiResponse({ status: 200, description: 'Password reset initiated.' })
  async resetPassword(@Body() body: { email: string }, @Request() req: any) {
    const email  = body.email;
    return this.authService.resetPassword(
      email,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('forgotpassword')
  @Public()
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
