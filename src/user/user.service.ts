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
    @InjectQueue('deletion') private deletionQueue: Queue,
  ) {}

  async create(user: CreateUserDto, ipAddress?: string, userAgent?: string) {
    const {
      email,
      fname,
      lname,
      role,
      language,
      accountCurrency,
      rules,
      tags,
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
      role: role ?? 'trader',
      language: language,
      password: hashed,
      accountCurrency: accountCurrency,
      tags: tags || [],
      rules: rulesData as Prisma.InputJsonValue,
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

    return {
      ...result,
      password: undefined,
    };
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

    const newUser = { ...user, password: undefined };

    return {
      ...newUser,
      rules:
        typeof user.rules === 'string'
          ? JSON.parse(user.rules)
          : user.rules && typeof user.rules === 'object'
            ? user.rules
            : { forex: { take_profit: [], stop_loss: [] } },
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
        ...userFound,
        password: undefined,
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
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
    });
  }

  async findOne(id: string): Promise<any | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    // Exclude deleted users
    if (user.deletedAt) {
      throw new NotFoundException('User account is scheduled for deletion');
    }

    return user;
  }

  async verifyEmailUpdate(id: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.email === email) return true;
    const userFound = await this.prisma.user.findUnique({ where: { email } });
    if (userFound) throw new NotFoundException('Email already in use');
    return true;
  }

  //TODO: Test email update
  async update(
    id: string,
    dto: UpdateUserDto,
    ipAddress?: string,
    userAgent?: string,
  ) {
    delete dto.id;
    const updatedFields = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (dto.email) {
      await this.verifyEmailUpdate(id, dto.email);
    }
    const data: any = { ...dto, updatedAt: new Date() };
    const update = await this.prisma.user.update({ where: { id }, data });

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
    if (dto.emailVerified === true) {
      this.analytics.trackEmailVerified(id);
    }
    if (dto.emailVerificationToken && dto.emailVerified !== true) {
      this.analytics.trackEmailVerificationRequested(id);
    }

    this.userGateway.server.emit('updated-user', {
      ...update,
      password: undefined,
    });
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

    this.userGateway.server.emit('updated-user', {
      ...updatedUser,
      daysRemaining,
      password: undefined,
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

    this.userGateway.server.emit('updated-user', {
      ...restoredUser,
      password: undefined,
    });

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
      include: {
        trade: true,
        journalEntries: true,
        refreshTokens: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Perform the permanent deletion with all cascading deletes
    // This will cascade delete: trades, journals, refresh tokens, audit logs
    await this.prisma.user.delete({
      where: { id },
    });

    // Log the final deletion
    await this.auditService.log({
      userId: id,
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
  async remove(id: string, ipAddress?: string, userAgent?: string) {
    return this.initiateAccountDeletion(id, ipAddress, userAgent);
  }
}
