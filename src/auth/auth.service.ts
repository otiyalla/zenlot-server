import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { JsonWebTokenError, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import {
  defaultExpiresIn,
  defaultRefreshExpiresIn,
  REFRESH_TOKEN_REUSE_GRACE_MS,
  resolveExpiration,
} from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, createHmac, randomBytes } from 'crypto';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { SocketSessionRegistry } from './socket-session-registry.service';

interface AccessTokenPayload {
  email: string;
  sub: string;
  authVersion: number;
}

interface RefreshTokenPayload {
  token: string;
}

type RefreshTokenClient = Pick<PrismaService, 'refreshToken'>;

// Refresh tokens are stored hashed, so even a database leak combined with the
// signing secret can't be replayed. The prefix marks hashed rows.
const HASHED_REFRESH_TOKEN_PREFIX = 'sha256:';
const hashRefreshToken = (token: string) =>
  `${HASHED_REFRESH_TOKEN_PREFIX}${createHash('sha256').update(token).digest('hex')}`;

// Rows written before hashing hold the raw value: accept that form until they
// expire (JWT_REFRESH_EXPIRES after this shipped), then drop it. A raw value
// carrying the hash prefix was never issued; matching it verbatim would let a
// leaked hash stand in for its token.
const storedRefreshTokenForms = (token: string) =>
  token.startsWith(HASHED_REFRESH_TOKEN_PREFIX)
    ? [hashRefreshToken(token)]
    : [hashRefreshToken(token), token];

// Safety bound on how far a grace-window retry follows a rotation chain. The
// real limit is the window itself: every link must have been rotated within it.
const MAX_GRACE_CHAIN_HOPS = 100;

interface VerifiedRefreshToken {
  user: StoredUser;
  token: string;
  // Revocation state at lookup. Revoked tokens are still returned so rotation
  // can tell a grace-window replay from token reuse.
  isRevoked?: boolean;
  revokedAt?: Date | null;
}

// Only a genuinely bad session (invalid/expired/revoked token, credentials
// changed mid-request) is a 401, which the client treats as "signed out".
// Infrastructure faults (e.g. the database is down) must surface as 5xx so the
// client keeps the session and retries instead of signing users out.
const isAuthRejection = (error: unknown) =>
  error instanceof HttpException || error instanceof JsonWebTokenError;

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
  authVersion: number;
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
    private readonly socketSessions: SocketSessionRegistry,
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
    const payload: AccessTokenPayload = {
      email: user.email,
      sub: user.id,
      authVersion: user.authVersion + 1,
    };
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
          data: { isRevoked: true, revokedAt: new Date() },
        });
        return this.createRefreshToken(payload, tx);
      });
      this.socketSessions.advanceAuthVersion(user.id, payload.authVersion);
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
      if (
        typeof decoded.sub !== 'string' ||
        typeof decoded.email !== 'string' ||
        !Number.isInteger(decoded.authVersion)
      ) {
        throw new UnauthorizedException('Access token is missing auth version');
      }
      const user = await this.userService.findByEmail(decoded.email);
      if (
        !user ||
        user.id !== decoded.sub ||
        user.authVersion !== decoded.authVersion
      ) {
        throw new NotFoundException('User not found');
      }
      const newUser = { ...user, password: undefined };
      return {
        ...newUser,
        isAuthenticated: true,
      };
    } catch (error) {
      // Expired/invalid tokens are routine (every access token expires within
      // the hour), so only unexpected failures are worth a Sentry event.
      if (isAuthRejection(error)) return null;
      // Anything else (e.g. the database is down) must surface as 5xx, not as
      // an invalid token: clients sign out on 401.
      this.logger.error('Error verifying token', error);
      Sentry.captureException(error, { extra: { context: 'verifyToken' } });
      throw error;
    }
  }

  async createRefreshToken(
    payload: { email: string; sub: string },
    db: RefreshTokenClient = this.prisma,
    token: string = randomBytes(32).toString('hex'),
  ) {
    const publicRefreshToken = this.signRefreshToken(token);
    // Store exactly the expiry signed into the JWT. Re-parsing
    // JWT_REFRESH_EXPIRES by hand misread valid values ("1w" became 1s).
    const { exp } = this.jwtService.decode<{ exp?: number }>(
      publicRefreshToken,
    );
    if (typeof exp !== 'number') {
      throw new Error('Signed refresh token has no expiry');
    }
    const refreshTokenExpiry = new Date(exp * 1000);

    try {
      await db.refreshToken.create({
        data: {
          token: hashRefreshToken(token),
          userId: payload.sub,
          expiresAt: refreshTokenExpiry,
        },
      });
      return publicRefreshToken;
    } catch (error) {
      this.logger.warn('Error creating refresh token', error);
      Sentry.captureException(error, {
        extra: { userId: payload.sub, context: 'createRefreshToken' },
      });
      throw error;
    }
  }

  // `expiresAt` caps a re-issued token at its stored record's expiry.
  private signRefreshToken(token: string, expiresAt?: Date): string {
    return this.jwtService.sign(
      { token },
      {
        secret: this.getRefreshSecret(),
        expiresIn: expiresAt
          ? Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
          : this.getRefreshExpiresIn(),
      },
    );
  }

  // Successors are derived from the token they replace (keyed by the refresh
  // secret), so a replay inside the grace window can be answered with the very
  // same successor without the server retaining raw token values.
  private deriveSuccessorToken(token: string): string {
    return createHmac('sha256', this.getRefreshSecret() ?? '')
      .update(`rotate:${token}`)
      .digest('hex');
  }

  // Decodes a public refresh token and loads its unexpired record, revoked or
  // not (see VerifiedRefreshToken).
  async verifyRefreshToken(token: string): Promise<VerifiedRefreshToken> {
    try {
      const decoded = this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.getRefreshSecret(),
      });

      const refreshTokenRecord = await this.prisma.refreshToken.findFirst({
        where: {
          token: { in: storedRefreshTokenForms(decoded.token) },
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

      const newUser: StoredUser = {
        ...refreshTokenRecord.user,
        isAuthenticated: true,
        password: undefined,
      };
      return {
        user: newUser,
        token: decoded.token,
        isRevoked: refreshTokenRecord.isRevoked,
        revokedAt: refreshTokenRecord.revokedAt,
      };
    } catch (error) {
      if (!isAuthRejection(error)) {
        this.logger.error('Error verifying refresh token', error);
        Sentry.captureException(error, {
          extra: { context: 'verifyRefreshToken' },
        });
        throw error;
      }
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
        const presented = await this.verifyRefreshToken(refreshToken);
        const { user } = presented;

        // Revoke first so a failed revocation never leaves the old token
        // usable while a replacement token has already been persisted.
        const newPayload: AccessTokenPayload = {
          email: user.email,
          sub: user.id,
          authVersion: user.authVersion,
        };
        const newRefreshTokenValue = await this.rotateRefreshToken(
          presented,
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
      if (!payload) {
        // Never answer an invalid token with an empty 200: clients would read
        // that as "keep the session" instead of refreshing or signing out.
        throw new UnauthorizedException('Invalid token');
      }
      if (payload.id) {
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
      if (!isAuthRejection(error)) {
        this.logger.error('Error verifying token', error);
        Sentry.captureException(error, { extra: { context: 'verify' } });
        throw error;
      }
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

    const payload: AccessTokenPayload = {
      email: newUser.email,
      sub: newUser.id,
      authVersion: newUser.authVersion,
    };

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
      await this.removePushTokens(userId);
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

  // Sign-out revokes every session for the user, so their devices must stop
  // receiving pushes too. The client's own push unregister is authenticated by
  // the access token and silently fails when that has expired, which would
  // otherwise leave a signed-out account's alerts reaching the device.
  // Best-effort: session revocation above is the security boundary and has
  // already succeeded, so a failure here must not fail the sign-out.
  private async removePushTokens(userId: string): Promise<void> {
    try {
      await this.prisma.pushToken.deleteMany({ where: { userId } });
    } catch (error) {
      this.logger.warn('Could not remove push tokens on sign-out');
      Sentry.captureException(error, {
        extra: { userId, context: 'removePushTokens' },
      });
    }
  }

  private async revokeAllRefreshTokens(
    userId: string,
    client: RefreshTokenClient = this.prisma,
  ): Promise<void> {
    try {
      await client.refreshToken.updateMany({
        where: {
          userId: userId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
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

  // Returns false when the token was already revoked, i.e. a concurrent
  // rotation claimed it first.
  private async revokeRefreshToken(
    token: string,
    client: RefreshTokenClient = this.prisma,
  ): Promise<boolean> {
    try {
      const result = await client.refreshToken.updateMany({
        where: {
          token: { in: storedRefreshTokenForms(token) },
          isRevoked: false,
        },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
        },
      });
      return result.count === 1;
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

  private async rotateRefreshToken(
    presented: VerifiedRefreshToken,
    payload: AccessTokenPayload,
  ): Promise<string> {
    if (presented.isRevoked) {
      return this.redeemRotatedRefreshToken(
        presented.token,
        payload.sub,
        presented.revokedAt ?? null,
      );
    }

    // Lock the same user row that password reset updates before touching refresh
    // tokens. Reset-first makes this conditional claim fail; rotation-first makes
    // reset wait and then revoke the replacement created below.
    const replacement = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: { id: payload.sub, authVersion: payload.authVersion },
        data: { authVersion: payload.authVersion },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException('Credentials changed during refresh');
      }
      if (!(await this.revokeRefreshToken(presented.token, tx))) return null;
      return this.createRefreshToken(
        payload,
        tx,
        this.deriveSuccessorToken(presented.token),
      );
    });
    if (replacement) return replacement;

    // A concurrent refresh rotated this token after we read it. Judge the
    // replay by when that actually happened: a request stalled past the
    // grace window is reuse, not a duplicate.
    const record = await this.prisma.refreshToken.findFirst({
      where: { token: { in: storedRefreshTokenForms(presented.token) } },
      select: { revokedAt: true },
    });
    return this.redeemRotatedRefreshToken(
      presented.token,
      payload.sub,
      record?.revokedAt ?? null,
    );
  }

  // Handles an already-revoked token. Within the grace window after its
  // rotation, re-issue the same successor so a lost/timed-out response or a
  // duplicate in-flight refresh is idempotent instead of signing the user out.
  // A rotated token replayed after the window means a copy is in someone
  // else's hands: revoke every refresh token for the user (reuse detection).
  private async redeemRotatedRefreshToken(
    token: string,
    userId: string,
    revokedAt: Date | null,
  ): Promise<string> {
    const withinGrace = (at: Date | null) =>
      at !== null && Date.now() - at.getTime() <= REFRESH_TOKEN_REUSE_GRACE_MS;
    // Derived successors only ever exist in hashed form. The lookup runs behind
    // the same user row lock rotation holds until it commits: an unlocked read
    // can observe a successor as still active in the instant before the
    // rotation replacing it commits, and handing that about-to-be-revoked token
    // back makes the client's next refresh look like reuse — which revokes
    // every session on the account.
    const findSuccessor = (of: string) => {
      const successorToken = this.deriveSuccessorToken(of);
      return this.prisma.$transaction(async (tx) => {
        await tx.user.updateMany({
          where: { id: userId },
          data: { authVersion: { increment: 0 } },
        });
        const row = await tx.refreshToken.findUnique({
          where: { token: hashRefreshToken(successorToken) },
        });
        return row ? { ...row, raw: successorToken } : null;
      });
    };

    let successor = await findSuccessor(token);
    if (!successor) {
      // Revoked without rotation: sign-out, sign-in elsewhere, password reset.
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (withinGrace(revokedAt)) {
      // Follow the chain while each link was itself rotated within the grace
      // window, so retrying a lost response still lands on the live token
      // after another request already rotated its successor.
      for (let hop = 0; hop < MAX_GRACE_CHAIN_HOPS; hop += 1) {
        if (!successor.isRevoked) {
          if (successor.expiresAt <= new Date()) break;
          return this.signRefreshToken(successor.raw, successor.expiresAt);
        }
        if (!withinGrace(successor.revokedAt)) break;
        const next = await findSuccessor(successor.raw);
        if (!next) break; // revoked without rotation (e.g. sign-out)
        successor = next;
      }
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Take the user row lock that rotation (and password reset) hold until they
    // commit. Under READ COMMITTED a lone revoke-all can wait on the successor
    // a concurrent rotation is replacing, then miss the replacement it inserts;
    // behind the lock the revocation sees and revokes it.
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: userId },
        data: { authVersion: { increment: 0 } },
      });
      await this.revokeAllRefreshTokens(userId, tx);
    });
    this.logger.warn(
      `Refresh token reuse detected for user ${userId}; revoked all sessions`,
    );
    Sentry.captureMessage('Refresh token reuse detected', {
      level: 'warning',
      extra: { userId },
    });
    await this.auditService.log({
      userId,
      action: 'AUTH_REFRESH_REUSE_DETECTED',
      resource: 'auth',
      resourceId: userId,
    });
    throw new UnauthorizedException('Refresh token has been revoked');
  }

  // Add a dedicated refresh endpoint method
  async refreshTokens(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    try {
      const presented = await this.verifyRefreshToken(refreshToken);
      const { user } = presented;
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Revoke first so a failed revocation never leaves the old token
      // usable while a replacement token has already been persisted.
      const payload: AccessTokenPayload = {
        email: user.email,
        sub: user.id,
        authVersion: user.authVersion,
      };
      const newRefreshTokenValue = await this.rotateRefreshToken(
        presented,
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
      if (!isAuthRejection(error)) {
        this.logger.error('Error refreshing tokens', error);
        Sentry.captureException(error, { extra: { context: 'refreshTokens' } });
        throw error;
      }
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
