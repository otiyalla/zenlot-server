import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { jwtConstants } from './auth.constants';

@Injectable()
export class AuthService {
    constructor(private readonly jwtService: JwtService, private userService: UserService) {}

    async signin(email: string, password: string) {
        const user = await this.userService.validateUser(email, password);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        const payload = { email: user.email, sub: user.id };
        return {
            access_token: this.jwtService.sign(payload, {
                secret: jwtConstants.secret,
                expiresIn: jwtConstants.expiresIn,
            }),
            refresh_token: this.jwtService.sign(payload, {
                secret: jwtConstants.refreshToken,
                expiresIn: jwtConstants.refreshTokenExpiresIn,
            }),
            user: {
                ...user,
                isAuthenticated: true,
            },
        };
    }

    async verifyToken(token: string){
        try {
            const decoded = this.jwtService.verify(token, { secret: jwtConstants.secret });
            const user = await this.userService.findByEmail(decoded.email);
            if (!user) {
                throw new NotFoundException('User not found');
            }
            const newUser = { ...user, password: undefined };
            return {
                ...newUser,
                isAuthenticated: true,
            };
        } catch (error) {
            console.error('Error verifying token:', error);
            return null; // Return null if token verification fails
        }
    }

      async verifyRefreshToken(token: string){
        try {
            const decoded = this.jwtService.verify(token, { secret: jwtConstants.refreshToken });
            const user = await this.userService.findByEmail(decoded.email);
            if (!user) {
                throw new NotFoundException('User not found');
            }
            const newUser = { ...user, password: undefined };
            return {
                ...newUser,
                isAuthenticated: true,
            };
        } catch (error) {
            console.error('Error verifying refresh token:', error);
            throw new NotFoundException('Invalid token');
        }
    }
    
    async verify(access_token: string, refresh_token?: string) {
        try {
            let payload = await this.verifyToken(access_token);
            if (!payload && refresh_token) {
                payload = await this.verifyRefreshToken(refresh_token);
                console.log('Payload from refresh token:', payload);
                if (!payload) throw new NotFoundException('Invalid refresh token');
            }
            return payload;
        } catch (error) {
            console.error('Error verifying token:', error, access_token, "\nrefe.." ,refresh_token);
            throw new NotFoundException('Invalid token');
        }
    }

    async signup(user: any) {
        const newUser = await this.userService.create(user);
        if (!newUser) {
            throw new NotFoundException('User could not be created');
        }
        const payload = { email: newUser.email, sub: newUser.id };
        return {
            access_token: await this.jwtService.sign(payload, {
                secret: jwtConstants.secret,
                expiresIn: jwtConstants.expiresIn,
            }),
            refresh_token: this.jwtService.sign(payload, {
                secret: jwtConstants.refreshToken,
                expiresIn: jwtConstants.refreshTokenExpiresIn,
            }),
            user: {
                ...newUser,
                isAuthenticated: true,
            },
        };
    }

    async resetPassword(email: string) {
        const user = await this.userService.findByEmail(email);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        const tempPassword = Math.random().toString(36).slice(-9);
        const newPassword = `tPass${tempPassword}`;
        console.log(' ---- NEW PASSWORD: ', newPassword, "-----");
        const updatedUser = await this.userService.resetPassword(user.id, newPassword);
        if (!updatedUser) {
            throw new NotFoundException('Could not update password');
        }
        return { message: 'Password updated successfully' };
    }


    async forgotPassword(email: string) {
        const user = await this.userService.findByEmail(email);
        if (!user) {
            throw new NotFoundException('User not found');
        }
        // Here you would typically send an email with a reset link
        return { message: 'Password reset link sent to your email' };
    }
}
