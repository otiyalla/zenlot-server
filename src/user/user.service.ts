import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '../../prisma/generated/prisma/client';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { UserGateway } from './user.gateway';
import { UserPasswordDto } from './dto/user-password.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AnalyticsService } from '../analytics/analytics.service';
import { SocketSessionRegistry } from '../auth/socket-session-registry.service';
import { isJournalReminderClaimActive } from '../notifications/journal-reminder-lease';
import { localDateHour } from '../notifications/journal-reminder.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly GRACE_PERIOD_DAYS = 30; // 30 days grace period
  private readonly DATA_RETENTION_DAYS = 210; // 210 days retention after deletion

  constructor(
    private readonly prisma: PrismaService,
    private readonly userGateway: UserGateway,
    private readonly auditService: AuditService,
    private readonly emailService: EmailService,
    private readonly analytics: AnalyticsService,
    private readonly socketSessions: SocketSessionRegistry,
    @InjectQueue('deletion') private deletionQueue: Queue,
  ) {}

  /**
   * Removes secrets/credentials that must never be serialized to clients:
   * the password hash and the email-verification token (which could be used
   * for account takeover if leaked).
   */
  private stripPassword<T extends { password?: string | null }>(
    user: T,
  ): Omit<T, 'password'> {
    const {
      password,
      emailVerificationToken,
      emailVerificationTokenExpiry,
      ...safeUser
    } = user as T & {
      emailVerificationToken?: string | null;
      emailVerificationTokenExpiry?: Date | string | null;
    };
    void password;
    void emailVerificationToken;
    void emailVerificationTokenExpiry;
    return safeUser as Omit<T, 'password'>;
  }

  async create(user: CreateUserDto, ipAddress?: string, userAgent?: string) {
    const {
      email,
      fname,
      lname,
      language,
      accountCurrency,
      rules,
      tags,
      timezone,
      togglePipValue,
      theme,
    } = user;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound)
      throw new NotFoundException('User already exists with this email');
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(user.password, salt);

    const defaultRules = { forex: { take_profit: [], stop_loss: [] } };
    const rulesData = rules ? rules : defaultRules;

    const data: Prisma.userCreateInput = {
      fname: fname,
      lname: lname,
      email: email,
      role: 'trader',
      language: language,
      password: hashed,
      accountCurrency: accountCurrency,
      tags: tags || [],
      rules: rulesData as Prisma.InputJsonValue,
      ...(theme !== undefined && { theme }),
      ...(timezone !== undefined && { timezone }),
      ...(togglePipValue !== undefined && { togglePipValue }),
    };
    const result = await this.prisma.user.create({ data });

    // Log user creation
    await this.auditService.log({
      userId: result.id,
      action: 'USER_CREATED',
      resource: 'user',
      resourceId: result.id,
      ipAddress,
      userAgent,
    });
    this.analytics.identifyUser(result);
    this.analytics.trackAccountCreated(result.id, 'email');
    await this.emailService.sendWelcomeEmail(email, fname, lname, language);

    return this.stripPassword(result);
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return null;

    // Prevent login if account is scheduled for deletion
    if (user.deletedAt) {
      return null;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return null;

    const newUser = this.stripPassword(user);

    return {
      ...newUser,
      rules: (typeof user.rules === 'string'
        ? JSON.parse(user.rules)
        : user.rules && typeof user.rules === 'object'
          ? user.rules
          : {
              forex: { take_profit: [], stop_loss: [] },
            }) as AuthenticatedUser['rules'],
    };
  }

  async signin(user: CreateUserDto) {
    const userFound = await this.prisma.user.findUnique({
      where: { email: user.email },
    });

    if (!userFound) throw new NotFoundException('User not found');
    // Prevent login if account is scheduled for deletion
    if (userFound.deletedAt) {
      throw new BadRequestException(
        'Your account is scheduled for deletion. Please contact support to restore your account.',
      );
    }

    try {
      const isMatch = await bcrypt.compare(userFound.password, user.password);
      if (!isMatch)
        throw new NotFoundException('User information is incorrect');
      const newUser = {
        ...this.stripPassword(userFound),
        rules: userFound.rules,
      };
      await this.auditService.log({
        userId: newUser.id,
        action: 'USER_SIGNED_IN',
        resource: 'user',
        resourceId: newUser.id,
      });
      return newUser;
    } catch (error) {
      this.logger.error('Error during signin', error);
      Sentry.captureException(error, {
        extra: { email: userFound?.email, context: 'signin' },
      });
      throw error;
    }
  }

  async changePassword(
    dto: UserPasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const { userId, currentPassword, newPassword } = dto;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.id) {
      throw new NotFoundException('password updated failed: user not found');
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) return null;
    const success = await this.resetPassword(user.id, newPassword);

    // Log password change
    await this.auditService.log({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
    });
    this.analytics.trackPasswordChanged(user.id);

    return !!success;
  }

  async resetPassword(id: string, newPassword: string) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    // Keep the credential update and persisted refresh-token revocation atomic.
    // Live sockets are contained immediately after this transaction commits.
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { password: hashedPassword, authVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, isRevoked: false },
        data: { isRevoked: true },
      });
      return updated;
    });
    this.socketSessions.advanceAuthVersion(id, updated.authVersion);
    return updated;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findAll() {
    return this.prisma.user
      .findMany({
        where: { deletedAt: null },
      })
      .then((users) => users.map((user) => this.stripPassword(user)))
      .catch((error) => {
        this.logger.error('Error finding all users', error);
        Sentry.captureException(error, {
          extra: { context: 'findAll' },
        });
        throw error;
      });
  }

  async findOne(id: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    // Exclude deleted users
    if (user.deletedAt) {
      throw new NotFoundException('User account is scheduled for deletion');
    }

    return this.stripPassword(user);
  }

  async verifyEmailUpdate(id: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email === email) return true;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('Email already in use');
    return true;
  }

  private async updateWithTimezoneReminderRebase(
    id: string,
    timezone: string,
    data: Prisma.userUpdateInput,
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const existing = await tx.user.findUniqueOrThrow({
            where: { id },
            select: { timezone: true },
          });
          const timezoneChanged = existing.timezone !== timezone;

          if (timezoneChanged) {
            const basisChangedAt = new Date();
            const preference = await tx.notificationPreference.findUnique({
              where: { userId: id },
              select: {
                reminderHour: true,
                lastReminderLocalDate: true,
                reminderClaimLocalDate: true,
                reminderClaimedAt: true,
              },
            });

            if (preference) {
              const oldLocal = localDateHour(basisChangedAt, existing.timezone);
              const oldDueDate = latestReminderDueDate(
                oldLocal.date,
                oldLocal.hour,
                preference.reminderHour,
              );
              const rebasedLocalDate = localDateHour(
                basisChangedAt,
                timezone,
              ).date;
              const activeClaim = isJournalReminderClaimActive(
                preference.reminderClaimLocalDate,
                preference.reminderClaimedAt,
                basisChangedAt,
              );
              const preferenceUpdate =
                await tx.notificationPreference.updateMany({
                  where: {
                    userId: id,
                    reminderHour: preference.reminderHour,
                    lastReminderLocalDate: preference.lastReminderLocalDate,
                    reminderClaimLocalDate: preference.reminderClaimLocalDate,
                    reminderClaimedAt: preference.reminderClaimedAt,
                  },
                  data: {
                    ...(preference.lastReminderLocalDate === oldDueDate
                      ? { lastReminderLocalDate: rebasedLocalDate }
                      : {}),
                    reminderClaimLocalDate: activeClaim
                      ? rebasedLocalDate
                      : null,
                    reminderClaimedAt: activeClaim
                      ? preference.reminderClaimedAt
                      : null,
                  },
                });
              if (preferenceUpdate.count === 0) {
                throw new TimezoneReminderBasisConflict();
              }
            }
          }

          const updatedUser = await tx.user.update({
            // Include the observed timezone so a concurrent basis change
            // forces a retry instead of making a stale no-clear decision.
            where: { id, timezone: existing.timezone },
            data,
          });

          return updatedUser;
        });
      } catch (error) {
        const errorCode =
          typeof error === 'object' && error !== null
            ? (error as { code?: unknown }).code
            : undefined;
        const isConditionalConflict =
          errorCode === 'P2025' ||
          error instanceof TimezoneReminderBasisConflict;
        if (!isConditionalConflict || attempt === 4) throw error;
      }
    }

    throw new Error(`User timezone changed too frequently for ${id}`);
  }

  //TODO: Test email update
  async update(
    id: string,
    dto: UpdateUserDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    delete dto.id;
    const allowedData: Prisma.userUpdateInput = {};

    if (dto.fname !== undefined) allowedData.fname = dto.fname;
    if (dto.lname !== undefined) allowedData.lname = dto.lname;
    if (dto.email !== undefined) allowedData.email = dto.email;
    if (dto.language !== undefined) allowedData.language = dto.language;
    if (dto.accountCurrency !== undefined)
      allowedData.accountCurrency = dto.accountCurrency;
    if (dto.theme !== undefined) allowedData.theme = dto.theme;
    if (dto.rules !== undefined)
      allowedData.rules = dto.rules as unknown as Prisma.InputJsonValue;
    if (dto.tags !== undefined) allowedData.tags = dto.tags;
    if (dto.timezone !== undefined) allowedData.timezone = dto.timezone;
    if (dto.togglePipValue !== undefined)
      allowedData.togglePipValue = dto.togglePipValue;

    const updatedFields = Object.entries(allowedData)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (dto.email) {
      await this.verifyEmailUpdate(id, dto.email);
    }
    const data: Prisma.userUpdateInput = {
      ...allowedData,
      updatedAt: new Date(),
    };
    const update =
      dto.timezone !== undefined
        ? await this.updateWithTimezoneReminderRebase(id, dto.timezone, data)
        : await this.prisma.user.update({ where: { id }, data });

    // Log user update
    await this.auditService.log({
      userId: id,
      action: 'USER_UPDATED',
      resource: 'user',
      resourceId: id,
      changes: { updated: data },
      ipAddress,
      userAgent,
    });
    this.analytics.trackUserUpdated(id, updatedFields);
    this.userGateway.emitUserUpdate(id, update);

    return this.stripPassword(update);
  }

  /**
   * Initiate account deletion with grace period
   * User has 30 days to cancel the deletion
   * After 30 days, the account is permanently deleted
   */
  async initiateAccountDeletion(
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      throw new BadRequestException(
        'Account is already scheduled for deletion',
      );
    }

    // Calculate grace period end time (30 days from now)
    const deleteScheduledFor = new Date();
    deleteScheduledFor.setDate(
      deleteScheduledFor.getDate() + this.GRACE_PERIOD_DAYS,
    );

    // Soft delete: set deletedAt timestamp
    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deleteScheduledFor,
      },
    });

    const daysRemaining = this.getDaysRemaining(deleteScheduledFor);

    this.userGateway.emitUserUpdate(id, {
      ...updatedUser,
      daysRemaining,
    });

    await this.deletionQueue.add(
      'permanent-deletion',
      { userId: id },
      {
        delay: this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000, // 30 days in milliseconds
        jobId: `deletion-${id}`,
      },
    );

    await this.auditService.log({
      userId: id,
      action: 'ACCOUNT_DELETION_INITIATED',
      resource: 'user',
      resourceId: id,
      changes: {
        deleteScheduledFor: deleteScheduledFor.toISOString(),
        gracePeriodDays: this.GRACE_PERIOD_DAYS,
      },
      ipAddress,
      userAgent,
    });
    this.analytics.trackAccountDeletionInitiated(
      id,
      this.GRACE_PERIOD_DAYS,
      deleteScheduledFor,
    );

    await this.emailService.sendAccountDeletionNotice(
      user.email,
      `${user.fname} ${user.lname}`,
      user.language,
      this.GRACE_PERIOD_DAYS,
      user.timezone,
    );

    return {
      message: 'Account deletion initiated',
      deleteScheduledFor,
      gracePeriodDays: this.GRACE_PERIOD_DAYS,
    };
  }

  /**
   * Cancel account deletion (undo the soft delete)
   */
  async cancelAccountDeletion(
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.deletedAt) {
      throw new BadRequestException('Account is not scheduled for deletion');
    }

    const restoredUser = await this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: null,
        deleteScheduledFor: null,
      },
    });

    try {
      const job = await this.deletionQueue.getJob(`deletion-${id}`);
      if (job) {
        await job.remove();
      }
    } catch (error) {
      this.logger.error('Failed to remove scheduled deletion job', error);
      Sentry.captureException(error, {
        extra: { userId: id, context: 'cancelAccountDeletion' },
      });
    }

    this.userGateway.emitUserUpdate(id, restoredUser);

    await this.emailService.sendAccountDeletionCancelledNotice(
      user.email,
      `${user.fname} ${user.lname}`,
      user.language,
      user.timezone,
    );

    await this.auditService.log({
      userId: id,
      action: 'ACCOUNT_DELETION_CANCELLED',
      resource: 'user',
      resourceId: id,
      ipAddress,
      userAgent,
    });
    this.analytics.trackAccountDeletionCancelled(id);

    return {
      message: 'Account deletion cancelled',
    };
  }

  /**
   * Permanently delete the user account and all associated data
   * This should only be called after the grace period expires
   */
  async permanentlyDeleteUser(
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        deletedAt: true,
        deleteScheduledFor: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    if (
      !user.deletedAt ||
      !user.deleteScheduledFor ||
      user.deleteScheduledFor > now
    ) {
      // A restored account, or a job that ran before its deadline, is stale.
      return;
    }

    // Re-check the deletion state atomically so a cancellation racing this job
    // cannot allow a stale snapshot to remove the restored account. The
    // database cascades associated records from this conditional delete.
    const deletion = await this.prisma.user.deleteMany({
      where: {
        id,
        deletedAt: { not: null },
        deleteScheduledFor: { lte: now },
      },
    });
    if (deletion.count === 0) {
      return;
    }

    // Log the final deletion. The user row is gone so userId must be null to
    // avoid violating the auditLog_userId_fkey foreign key; resourceId carries
    // the identity instead.
    await this.auditService.log({
      action: 'ACCOUNT_DELETED',
      resource: 'user',
      resourceId: id,
      ipAddress,
      userAgent,
    });
    this.analytics.trackAccountDeleted(id);

    this.logger.log(`User ${id} permanently deleted`);
  }

  private getDaysRemaining = (deleteScheduledFor: Date): number => {
    const now = new Date();
    const daysRemaining = Math.ceil(
      (deleteScheduledFor.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysRemaining;
  };

  /**
   * Get account deletion status
   */
  async getDeletionStatus(id: string): Promise<any> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.deletedAt) {
      return {
        isScheduledForDeletion: false,
      };
    }

    const now = new Date();
    const deleteScheduledFor = user.deleteScheduledFor ?? now;
    const daysRemaining = this.getDaysRemaining(deleteScheduledFor);

    return {
      isScheduledForDeletion: true,
      deletedAt: user.deletedAt,
      deleteScheduledFor: user.deleteScheduledFor,
      daysRemaining: Math.max(0, daysRemaining),
    };
  }

  // Legacy method - kept for backward compatibility, now calls initiateAccountDeletion
  async remove(
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<unknown> {
    return this.initiateAccountDeletion(id, ipAddress, userAgent);
  }
}

class TimezoneReminderBasisConflict extends Error {}

function latestReminderDueDate(
  localDate: string,
  localHour: number,
  reminderHour: number,
): string {
  if (localHour >= reminderHour) return localDate;
  const previousDate = new Date(`${localDate}T00:00:00.000Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return previousDate.toISOString().slice(0, 10);
}
