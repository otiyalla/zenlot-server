import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/prisma/client';

export interface AuditLogInput {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId ?? 'Unavailable',
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? 'unknown',
          changes: input.changes as Prisma.InputJsonValue,
          ipAddress: input.ipAddress ?? 'Unavailable',
          userAgent: input.userAgent ?? 'Unknown',
        },
      });
    } catch (error) {
      // Log service should not throw - just log error and continue
      this.logger.error('Audit logging failed', error);
      Sentry.captureException(error, {
        extra: {
          action: input.action,
          resource: input.resource,
          context: 'AuditService.log',
        },
      });
    }
  }

  async getLogs(
    userId?: string,
    action?: string,
    limit: number = 100,
    offset: number = 0,
  ) {
    return this.prisma.auditLog.findMany({
      where: {
        ...(userId && { userId }),
        ...(action && { action }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async getDeletionScheduleLog(userId: string) {
    return this.prisma.auditLog.findFirst({
      where: {
        userId,
        action: 'ACCOUNT_DELETION_INITIATED',
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
