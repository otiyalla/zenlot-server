import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Post, Body, Get } from '@nestjs/common';
import { Public } from '../custom_decorator/public.decorator'; // Adjust the import path as necessary

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
    async signin(@Body() body: { email: string; password: string }) {
        const { email, password } = body;
        return this.authService.signin(email, password);
    }

    @Post('verify')
    @Public()
    async verify(@Body() body: { token: string; refresh_token: string }) {
        const { token, refresh_token } = body;
        return this.authService.verify(token, refresh_token);
    }

    @Post('signup')
    @Public()
    async signup(@Body() body: any) {
        return this.authService.signup(body)
    }

    @Post('resetpassword')
    @Public()
    async resetPassword(@Body() email: string ) {
        console.log('reset password fpr email:', email)
        return this.authService.resetPassword(email);
    }

    @Post('forgotpassword')
    @Public()
    async forgotPassword(@Body() body: { email: string }) {
        const { email } = body;
        return this.authService.forgotPassword(email);
    }

}
