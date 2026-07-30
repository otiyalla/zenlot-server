import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Expo } from 'expo-server-sdk';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { pushToken } from '../../prisma/generated/prisma/client';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Injectable()
export class PushTokenService {
  private readonly logger = new Logger(PushTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers (or refreshes) a device's Expo push token. The token must be a
   * valid Expo token. Idempotent in two ways:
   *  - same (userId, deviceId): updates the existing row in place (handles a
   *    device whose Expo token rotated);
   *  - same token already owned by another user (e.g. shared/recycled device):
   *    re-points it to the current user and re-enables it.
   */
  async register(
    userId: string,
    dto: RegisterPushTokenDto,
  ): Promise<pushToken> {
    if (!Expo.isExpoPushToken(dto.token)) {
      throw new BadRequestException(
        `"${dto.token}" is not a valid Expo push token`,
      );
    }

    const base = {
      token: dto.token,
      platform: dto.platform,
      deviceId: dto.deviceId ?? null,
      deviceName: dto.deviceName ?? null,
      enabled: true,
      lastError: null,
      lastErrorAt: null,
    };

    // If this exact token already exists (possibly under another user), claim it.
    const byToken = await this.prisma.pushToken.findUnique({
      where: { token: dto.token },
    });
    if (byToken) {
      return this.prisma.pushToken.update({
        where: { token: dto.token },
        data: { userId, ...base },
      });
    }

    // Otherwise, upsert on (userId, deviceId) when a deviceId is supplied so a
    // re-install/token-rotation from the same device replaces the old row.
    if (dto.deviceId) {
      const byDevice = await this.prisma.pushToken.findUnique({
        where: { userId_deviceId: { userId, deviceId: dto.deviceId } },
      });
      if (byDevice) {
        return this.prisma.pushToken.update({
          where: { id: byDevice.id },
          data: base,
        });
      }
    }

    return this.prisma.pushToken.create({ data: { userId, ...base } });
  }

  /** Removes a token for a user (used on logout / preference opt-out). */
  async unregister(
    userId: string,
    token: string,
  ): Promise<{ removed: number }> {
    const { count } = await this.prisma.pushToken.deleteMany({
      where: { userId, token },
    });
    return { removed: count };
  }

  /** All enabled tokens for a user. */
  async getEnabledTokens(userId: string): Promise<pushToken[]> {
    return this.prisma.pushToken.findMany({
      where: { userId, enabled: true },
    });
  }

  /** Marks a token as touched after a successful send. Best-effort. */
  async markUsed(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    try {
      await this.prisma.pushToken.updateMany({
        where: { token: { in: tokens } },
        data: { lastUsedAt: new Date() },
      });
    } catch (error) {
      this.logger.warn('Failed to mark tokens as used');
      Sentry.captureException(error, {
        extra: { context: 'PushTokenService.markUsed' },
      });
    }
  }

  /**
   * Soft-disables tokens Expo reported as undeliverable (DeviceNotRegistered).
   * We disable rather than delete so the row is available for diagnostics and so
   * a later re-register cleanly re-enables it. Best-effort.
   */
  async disableTokens(tokens: string[], reason: string): Promise<void> {
    if (tokens.length === 0) return;
    try {
      await this.prisma.pushToken.updateMany({
        where: { token: { in: tokens } },
        data: { enabled: false, lastError: reason, lastErrorAt: new Date() },
      });
      this.logger.log(`Disabled ${tokens.length} push token(s): ${reason}`);
    } catch (error) {
      this.logger.warn('Failed to disable push tokens');
      Sentry.captureException(error, {
        extra: { context: 'PushTokenService.disableTokens' },
      });
    }
  }
}

export class InvalidExpoTokenError extends Error {
  constructor(token: string) {
    super(`"${token}" is not a valid Expo push token`);
    this.name = 'InvalidExpoTokenError';
  }
}
