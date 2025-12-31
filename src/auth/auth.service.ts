import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { jwtConstants } from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService, 
        private userService: UserService,
        private prisma: PrismaService
    ) {}

    async signin(email: string, password: string) {
        const user = await this.userService.validateUser(email, password);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        // Revoke all existing refresh tokens for this user
        const payload = { email: user.email, sub: user.id };
        try {
            await this.revokeAllRefreshTokens(user.id);
            const refreshTokenValue = await this.createRefreshToken(payload);
            return {
                access_token: this.jwtService.sign(payload, {
                    secret: jwtConstants.secret,
                    expiresIn: jwtConstants.expiresIn,
                }),
                refresh_token: refreshTokenValue,
                user: {
                    ...user,
                    isAuthenticated: true,
                },
            };
        } catch (error) {
            console.error('error signing in: ', error);
        }
        
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

    async createRefreshToken(payload: { email: string, sub: string }){
        
        const token = randomBytes(32).toString('hex');
        const publicRefreshToken = this.jwtService.sign({token}, {
            secret: jwtConstants.refreshSecret,
            expiresIn: jwtConstants.refreshTokenExpiresIn,
        });

        const refreshTokenExpiry = new Date();
        refreshTokenExpiry.setSeconds(refreshTokenExpiry.getSeconds() + this.parseExpiration(jwtConstants.refreshTokenExpiresIn));

        try {
            await (this.prisma as any).refreshToken.create({
                data: {
                    token,
                    userId: payload.sub,
                    expiresAt: refreshTokenExpiry,
                },
            });

        } catch (error) {
            console.warn('error creating refresh token: ', error);
        } finally {
            return publicRefreshToken ?? '';
        }


    };

    async verifyRefreshToken(token: string){
        try {
            const decoded = this.jwtService.verify(token , { secret: jwtConstants.refreshSecret });
            const refreshTokenRecord = await (this.prisma as any).refreshToken.findFirst({
                where: {
                    token: decoded.token,
                    expiresAt: {
                        gt: new Date()
                    }
                },
                include: {
                    user: true
                }
            });
            
            if (!refreshTokenRecord) {
                throw new UnauthorizedException('Invalid or expired refresh token');
            }

            const user = refreshTokenRecord.user;
            const newUser = { ...user, isAuthenticated: true, password: undefined };
            return {
                user: newUser,
                token: decoded.token,
            };
        } catch (error) {
            console.error('Error verifying refresh token:', error, '\nrefresh token: ', token);
            throw new UnauthorizedException('Invalid refresh token');
        }
    }
    
    async verify(access_token: string, refresh_token?: string) {
        try {
            let payload = await this.verifyToken(access_token);
            if (!payload && refresh_token) {
                const {user, token}  = await this.verifyRefreshToken(refresh_token);
                if (!payload) throw new UnauthorizedException('Invalid refresh token');
                
                // Generate new tokens
                const newPayload = { email: user.email, sub: user.id };
                const newRefreshTokenValue = await this.createRefreshToken(newPayload);
                await this.revokeRefreshToken(token);
             
                return {
                    ...user,
                    access_token: this.jwtService.sign(newPayload, {
                        secret: jwtConstants.secret,
                        expiresIn: jwtConstants.expiresIn,
                    }),
                    refresh_token: newRefreshTokenValue,
                };
            }
            return payload;
        } catch (error) {
            console.error('Error verifying token:', error, "\n:access_token",access_token, "\nrefe.." ,refresh_token);
            throw new UnauthorizedException('Invalid token');
        }
    }

    async signup(user: any) {
        const newUser = await this.userService.create(user);
        if (!newUser) {
            throw new NotFoundException('User could not be created');
        }

        const payload = { email: newUser.email, sub: newUser.id };
        
        const refreshTokenValue = await this.createRefreshToken(payload);
       
        return {
            access_token: this.jwtService.sign(payload, {
                secret: jwtConstants.secret,
                expiresIn: jwtConstants.expiresIn,
            }),
            refresh_token: refreshTokenValue,
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
        await this.resetPassword(email);
        return { message: 'Password reset link sent to your email' };
    }

    async signout(userId: string) {
        this.revokeAllRefreshTokens(userId);
    }

    // Helper methods
    
    private async revokeAllRefreshTokens(userId: string): Promise<void> {
        try {
            await (this.prisma as any).refreshToken.updateMany({
                where: {
                    userId: userId,
                    isRevoked: false
                },
                data: {
                    isRevoked: true
                }
            });
        } catch (error) {
            console.warn('RefreshToken model not yet available. Please run: npx prisma generate');
        }
    }

    private async revokeRefreshToken(token: string): Promise<void> {
        try {
            await (this.prisma as any).refreshToken.updateMany({
                where: {
                    token: token
                },
                data: {
                    isRevoked: true
                }
            });
        } catch (error) {
            console.warn('RefreshToken model not yet available. Please run: npx prisma generate');
        }
    }

    private parseExpiration(expiration: string): number {
        const unit = expiration.slice(-1);
        const value = parseInt(expiration.slice(0, -1));
        
        switch (unit) {
            case 's': return value;
            case 'm': return value * 60;
            case 'h': return value * 60 * 60;
            case 'd': return value * 24 * 60 * 60;
            default: return value;
        }
    }

    // Add a dedicated refresh endpoint method
    async refreshTokens(refreshToken: string) {
        try {
            const {user, token} = await this.verifyRefreshToken(refreshToken);
            if (!user) {
                throw new UnauthorizedException('Invalid refresh token');
            }

            // Generate new tokens
            const payload = { email: user.email, sub: user.id };
            const newRefreshTokenValue = await this.createRefreshToken(payload);
            await this.revokeRefreshToken(token);
            return {
                access_token: this.jwtService.sign(payload, {
                    secret: jwtConstants.secret,
                    expiresIn: jwtConstants.expiresIn,
                }),
                refresh_token: newRefreshTokenValue,
                user: {
                    ...user,
                    isAuthenticated: true,
                },
            };
        } catch (error) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }
}
