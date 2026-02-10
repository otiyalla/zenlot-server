import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { AnalyticsService } from '../analytics/analytics.service';

const FEEDBACK_RATELIMIT_KEY_PREFIX = 'feedback:ratelimit:';
const FEEDBACK_RATELIMIT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_FEEDBACK_LIMIT = 5;

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
    @InjectQueue('deletion') private readonly queue: Queue,
    private readonly config: ConfigService,
    private readonly analytics: AnalyticsService,
  ) {}

  private getFeedbackLimit(): number {
    const limit = this.config.get<number>(
      'FEEDBACK_RATE_LIMIT_PER_USER_PER_DAY',
    );
    const n = limit != null ? Number(limit) : DEFAULT_FEEDBACK_LIMIT;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_FEEDBACK_LIMIT;
  }

  private async checkFeedbackRateLimit(ipAddress: string): Promise<void> {
    const key = `${FEEDBACK_RATELIMIT_KEY_PREFIX}${ipAddress || 'anonymous'}`;
    const redis = await this.queue.client;
    if (!redis) {
      return; // no Redis: skip rate limit (e.g. tests)
    }
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, FEEDBACK_RATELIMIT_TTL_SECONDS);
    }
    const limit = this.getFeedbackLimit();
    if (count > limit) {
      throw new BadRequestException(
        'Too many feedback submissions. Please try again later.',
      );
    }
  }

  async submitFeedback(
    dto: CreateFeedbackDto,
    ipAddress?: string,
  ): Promise<any> {
    await this.checkFeedbackRateLimit(ipAddress ?? '');

    // Create feedback record in database
    const feedback = await this.prisma.feedback.create({
      data: {
        userId: dto.userId,
        email: dto.email,
        subject: dto.subject,
        message: dto.message,
        type: dto.type || 'feedback',
      },
    });

    // Log the feedback submission
    await this.auditService.log({
      userId: dto.userId,
      action: 'FEEDBACK_SUBMITTED',
      resource: 'feedback',
      resourceId: feedback.id,
      ipAddress,
      changes: {
        type: dto.type,
        email: dto.email,
      },
    });

    const distinctId = dto.userId || feedback.id;

    this.analytics.trackFeedbackSubmitted(
      distinctId,
      feedback.id,
      dto.type,
      dto.userId,
      );

    // Send email notification to admin
    const emailSent = await this.emailService.sendFeedbackEmail(
      dto.email,
      dto.subject,
      dto.message,
      dto.type || 'feedback',
    );
    if (emailSent) {
      this.analytics.trackFeedbackEmailSent(
        distinctId,
        feedback.id,
        dto.type,
        dto.userId,
      );
    }

    return {
      id: feedback?.id,
      message: 'Feedback submitted successfully',
      emailSent: true,
    };
  }

  async getFeedbackByUser(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ) {
    return this.prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async updateFeedbackStatus(feedbackId: string, status: string) {
    return this.prisma.feedback.update({
      where: { id: feedbackId },
      data: { status },
    });
  }
}
