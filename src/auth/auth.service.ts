import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import {
  defaultExpiresIn,
  defaultRefreshExpiresIn,
  resolveExpiration,
} from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from '../user/dto/create-user.dto';

interface AccessTokenPayload {
  email: string;
  sub: string;
}

interface RefreshTokenPayload {
  token: string;
}

type RefreshTokenClient = Pick<PrismaService, 'refreshToken'>;

interface StoredUser {
  id: string;
  email: string;
  fname: string;
  lname: string;
  language: string;
  role: string;
  accountCurrency: string;
  theme: string;
  timezone: string;
  togglePipValue: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  password?: string | null;
  isAuthenticated?: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private userService: UserService,
    private emailService: EmailService,
    private prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly analytics: AnalyticsService,
    private readonly auditService: AuditService,
  ) {}

  private getAccessSecret(): string | undefined {
    return this.config.get<string>('JWT_SECRET');
  }

  private getRefreshSecret(): string | undefined {
    return this.config.get<string>('JWT_REFRESH_SECRET');
  }

  private getAccessExpiresIn() {
    return resolveExpiration(
      this.config.get<string>('JWT_EXPIRES'),
      defaultExpiresIn,
    );
  }

  private getRefreshExpiresIn() {
    return resolveExpiration(
      this.config.get<string>('JWT_REFRESH_EXPIRES'),
      defaultRefreshExpiresIn,
    );
  }

  async signin(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.userService.validateUser(email, password);
    if (!user) {
      const knownUser = await this.userService.findByEmail(email);
      const distinctId = knownUser?.id || this.getAnonymousDistinctId(email);
      this.analytics.trackAuthFailed(
        distinctId,
        'signin',
        'invalid_credentials',
      );
      await this.auditService.log({
        userId: knownUser?.id,
        action: 'AUTH_SIGNIN_FAILED',
        resource: 'auth',
        resourceId: knownUser?.id,
        changes: { reason: 'invalid_credentials' },
        ipAddress,
        userAgent,
      });
      throw new NotFoundException('User not found');
    }

    // Revoke all existing refresh tokens for this user
    const payload = { email: user.email, sub: user.id };
    try {
      const refreshTokenValue = await this.prisma.$transaction(async (tx) => {
        // Claim the credential generation that was validated above. Password
        // resets increment it, so an obsolete password cannot establish a new
        // session after a concurrent reset.
        const claimed = await tx.user.updateMany({
          where: { id: user.id, authVersion: user.authVersion },
          data: { authVersion: { increment: 1 } },
        });
        if (claimed.count !== 1) {
          throw new UnauthorizedException('Credentials changed during sign-in');
        }

        await tx.refreshToken.updateMany({
          where: { userId: user.id, isRevoked: false },
          data: { isRevoked: true },
        });
        return this.createRefreshToken(payload, tx);
      });
      const options = {
        secret: this.getAccessSecret(),
        expiresIn: this.getAccessExpiresIn(),
      };
      this.analytics.trackUserSignedIn(user.id, 'email');
      await this.auditService.log({
        userId: user.id,
        action: 'AUTH_SIGNIN_SUCCESS',
        resource: 'auth',
        resourceId: user.id,
        ipAddress,
        userAgent,
      });
      return {
        accessToken: this.jwtService.sign(payload, options),
        refreshToken: refreshTokenValue,
        user: {
          ...user,
          isAuthenticated: true,
        },
      };
    } catch (error) {
      this.logger.error('Error signing in', error);
      Sentry.captureException(error, { extra: { email, context: 'signin' } });
      this.analytics.trackAuthFailed(user.id, 'signin', 'server_error');
      await this.auditService.log({
        userId: user.id,
        action: 'AUTH_SIGNIN_FAILED',
        resource: 'auth',
        resourceId: user.id,
        changes: { reason: 'server_error' },
        ipAddress,
        userAgent,
      });
      throw error;
    }
  }

  async verifyToken(token: string) {
    try {
      const decoded = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.getAccessSecret(),
      });
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
      this.logger.error('Error verifying token', error);
      Sentry.captureException(error, { extra: { context: 'verifyToken' } });
      return null; // Return null if token verification fails
    }
  }

  async createRefreshToken(
    payload: { email: string; sub: string },
    db: Pick<PrismaService, 'refreshToken'> = this.prisma,
  ) {
    const token = randomBytes(32).toString('hex');
    const publicRefreshToken = this.jwtService.sign(
      { token },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.getRefreshExpiresIn(),
      },
    );

    const refreshTokenExpiry = new Date();
    refreshTokenExpiry.setSeconds(
      refreshTokenExpiry.getSeconds() +
        this.parseExpiration(this.getRefreshExpiresIn()),
    );

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (db as any).refreshToken.create({
        data: {
          token,
          userId: payload.sub,
          expiresAt: refreshTokenExpiry,
        },
      });
      return publicRefreshToken ?? '';
    } catch (error) {
      this.logger.warn('Error creating refresh token', error);
      Sentry.captureException(error, {
        extra: { userId: payload.sub, context: 'createRefreshToken' },
      });
      throw new UnauthorizedException('Could not create refresh token');
    }
    return publicRefreshToken ?? '';
  }

  async verifyRefreshToken(
    token: string,
  ): Promise<{ user: StoredUser; token: string }> {
    try {
      const decoded = this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.getRefreshSecret(),
      });

      const refreshTokenRecord: { token: string; user: StoredUser } | null =
        await (
          this.prisma as unknown as {
            refreshToken: {
              findFirst: (
                args: unknown,
              ) => Promise<{ token: string; user: StoredUser } | null>;
            };
          }
        ).refreshToken.findFirst({
          where: {
            token: decoded.token,
            isRevoked: false,
            expiresAt: {
              gt: new Date(),
            },
          },
          include: {
            user: true,
          },
        });

      if (!refreshTokenRecord) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const user = refreshTokenRecord.user;
      const newUser: StoredUser = {
        ...user,
        isAuthenticated: true,
        password: undefined,
      };
      return {
        user: newUser,
        token: decoded.token,
      };
    } catch (error) {
      this.logger.error('Error verifying refresh token', error);
      Sentry.captureException(error, {
        extra: { context: 'verifyRefreshToken' },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async verify(
    accessToken: string,
    refreshToken?: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    try {
      const payload = await this.verifyToken(accessToken);
      if (!payload && refreshToken) {
        const { user, token } = await this.verifyRefreshToken(refreshToken);

        // Revoke first so a failed revocation never leaves the old token
        // usable while a replacement token has already been persisted.
        const newPayload = { email: user.email, sub: user.id };
        const newRefreshTokenValue = await this.rotateRefreshToken(
          token,
          newPayload,
        );
        this.analytics.trackTokensRefreshed(user.id, 'verify');
        this.analytics.trackSessionVerified(user.id, true);
        await this.auditService.log({
          userId: user.id,
          action: 'AUTH_VERIFY_SUCCESS',
          resource: 'auth',
          resourceId: user.id,
          changes: { usedRefreshToken: true },
          ipAddress,
          userAgent,
        });

        return {
          ...user,
          accessToken: this.jwtService.sign(newPayload, {
            secret: this.getAccessSecret(),
            expiresIn: this.getAccessExpiresIn(),
          }),
          refreshToken: newRefreshTokenValue,
        };
      }
      if (payload?.id) {
        this.analytics.trackSessionVerified(payload.id, false);
        await this.auditService.log({
          userId: payload.id,
          action: 'AUTH_VERIFY_SUCCESS',
          resource: 'auth',
          resourceId: payload.id,
          changes: { usedRefreshToken: false },
          ipAddress,
          userAgent,
        });
      }
      return payload;
    } catch (error) {
      this.logger.error('Error verifying token', error);
      Sentry.captureException(error, { extra: { context: 'verify' } });
      const distinctId = this.getAnonymousDistinctId(ipAddress || 'unknown');
      this.analytics.trackAuthFailed(distinctId, 'verify', 'invalid_token');
      await this.auditService.log({
        action: 'AUTH_VERIFY_FAILED',
        resource: 'auth',
        changes: { reason: 'invalid_token' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid token');
    }
  }

  async signup(user: CreateUserDto, ipAddress?: string, userAgent?: string) {
    const newUser = await this.userService.create(user, ipAddress, userAgent);
    if (!newUser) {
      throw new NotFoundException('User could not be created');
    }

    const payload = { email: newUser.email, sub: newUser.id };

    const refreshTokenValue = await this.createRefreshToken(payload);

    return {
      accessToken: this.jwtService.sign(payload, {
        secret: this.getAccessSecret(),
        expiresIn: this.getAccessExpiresIn(),
      }),
      refreshToken: refreshTokenValue,
      user: {
        ...newUser,
        isAuthenticated: true,
      },
    };
  }

  async resetPassword(email: string, ipAddress?: string, userAgent?: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const tempPassword = Math.random().toString(36).slice(-9);
    const newPassword = `tPass${tempPassword}`;
    this.logger.log(`Password reset for ${email}`);
    const updatedUser = await this.userService.resetPassword(
      user.id,
      newPassword,
    );
    if (!updatedUser) {
      throw new NotFoundException('Could not update password');
    }
    this.analytics.trackPasswordReset(user.id);
    const emailSent = await this.emailService.sendPasswordResentEmail(
      email,
      newPassword,
      user.fname,
      user.language,
    );
    void this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_RESET_SUCCESS',
      resource: 'auth',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });
    return emailSent;
  }

  async forgotPassword(email: string, ipAddress?: string, userAgent?: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // Here you would typically send an email with a reset link
    this.analytics.trackPasswordResetRequested(user.id);
    const res = await this.resetPassword(email, ipAddress, userAgent);
    return res;
  }

  async signout(userId: string, ipAddress?: string, userAgent?: string) {
    try {
      await this.revokeAllRefreshTokens(userId);
      await this.auditService.log({
        userId,
        action: 'AUTH_SIGNOUT_SUCCESS',
        resource: 'auth',
        resourceId: userId,
        ipAddress,
        userAgent,
      });
    } catch (error) {
      this.analytics.trackAuthFailed(userId, 'signout', 'server_error');
      await this.auditService.log({
        userId,
        action: 'AUTH_SIGNOUT_FAILED',
        resource: 'auth',
        resourceId: userId,
        changes: { reason: 'server_error' },
        ipAddress,
        userAgent,
      });
      throw error;
    }
    this.analytics.trackUserSignedOut(userId);
  }

  // Helper methods

  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await (this.prisma as any).refreshToken.updateMany({
        where: {
          userId: userId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    } catch (error) {
      this.logger.warn('Could not revoke refresh tokens for user');
      Sentry.captureException(error, {
        extra: { userId, context: 'revokeAllRefreshTokens' },
      });
      // Revocation is a security boundary. Never report sign-in/sign-out or
      // rotation success when the database could not invalidate old tokens.
      throw error;
    }
  }

  private async revokeRefreshToken(
    token: string,
    client: RefreshTokenClient = this.prisma,
  ): Promise<void> {
    try {
      const result = await client.refreshToken.updateMany({
        where: {
          token: token,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
      if (result.count !== 1) {
        throw new UnauthorizedException('Refresh token is no longer valid');
      }
    } catch (error) {
      this.logger.warn('Could not revoke refresh token');
      Sentry.captureException(error, {
        extra: { context: 'revokeRefreshToken' },
      });
      // A failed rotation must not be reported as successful while the old
      // refresh token remains valid.
      throw error;
    }
  }

  private rotateRefreshToken(
    token: string,
    payload: { email: string; sub: string },
  ): Promise<string> {
    // Claim the old token and create its replacement in one transaction. This
    // prevents a concurrent password reset from being followed by a new session.
    return this.prisma.$transaction(async (tx) => {
      await this.revokeRefreshToken(token, tx);
      return this.createRefreshToken(payload, tx);
    });
  }

  private parseExpiration(expiration: string): number {
    const unit = expiration.slice(-1);
    const value = parseInt(expiration.slice(0, -1));

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 24 * 60 * 60;
      default:
        return value;
    }
  }

  // Add a dedicated refresh endpoint method
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    try {
      const { user, token } = await this.verifyRefreshToken(refreshToken);
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Revoke first so a failed revocation never leaves the old token
      // usable while a replacement token has already been persisted.
      const payload = { email: user.email, sub: user.id };
      const newRefreshTokenValue = await this.rotateRefreshToken(
        token,
        payload,
      );
      this.analytics.trackTokensRefreshed(user.id, 'refresh');
      await this.auditService.log({
        userId: user.id,
        action: 'AUTH_REFRESH_SUCCESS',
        resource: 'auth',
        resourceId: user.id,
        ipAddress,
        userAgent,
      });
      return {
        accessToken: this.jwtService.sign(payload, {
          secret: this.getAccessSecret(),
          expiresIn: this.getAccessExpiresIn(),
        }),
        refreshToken: newRefreshTokenValue,
        user: {
          ...user,
          isAuthenticated: true,
        },
      };
    } catch (error) {
      this.logger.error('Error refreshing tokens', error);
      Sentry.captureException(error, { extra: { context: 'refreshTokens' } });
      const distinctId = this.getAnonymousDistinctId(ipAddress || 'unknown');
      this.analytics.trackAuthFailed(
        distinctId,
        'refresh',
        'invalid_refresh_token',
      );
      await this.auditService.log({
        action: 'AUTH_REFRESH_FAILED',
        resource: 'auth',
        changes: { reason: 'invalid_refresh_token' },
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private getAnonymousDistinctId(value: string): string {
    return `anon:${String(value).trim().toLowerCase()}`;
  }
}
