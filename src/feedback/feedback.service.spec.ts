import { ConfigService } from '@nestjs/config';
import { FeedbackService } from './feedback.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from '../analytics/analytics.service';

describe('FeedbackService', () => {
  const dto = {
    email: 'trader@example.com',
    subject: 'Feature request',
    message: 'Please add dark mode.',
    type: 'feature' as const,
    userId: 'user-1',
  };

  function makeService(emailSent: boolean) {
    const prisma = {
      feedback: {
        create: jest.fn().mockResolvedValue({ id: 'feedback-1' }),
      },
    };
    const emailService = {
      sendFeedbackEmail: jest.fn().mockResolvedValue(emailSent),
    };
    const auditService = { log: jest.fn().mockResolvedValue(undefined) };
    const analytics = {
      trackFeedbackSubmitted: jest.fn(),
      trackFeedbackEmailSent: jest.fn(),
    };
    const queue = { client: Promise.resolve(null) };
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    };

    return {
      service: new FeedbackService(
        prisma as unknown as PrismaService,
        emailService as unknown as EmailService,
        auditService as unknown as AuditService,
        queue as never,
        config as unknown as ConfigService,
        analytics as unknown as AnalyticsService,
      ),
      emailService,
      analytics,
    };
  }

  it('reports successful administrative email delivery', async () => {
    const { service, emailService, analytics } = makeService(true);

    const result = await service.submitFeedback(dto, '127.0.0.1');

    expect(result).toEqual({
      id: 'feedback-1',
      message: 'Feedback submitted successfully',
      emailSent: true,
    });
    expect(emailService.sendFeedbackEmail).toHaveBeenCalledWith(
      dto.email,
      dto.subject,
      dto.message,
      dto.type,
    );
    expect(analytics.trackFeedbackEmailSent).toHaveBeenCalledWith(
      'user-1',
      'feedback-1',
      dto.type,
      'user-1',
    );
  });

  it('reports failed administrative email delivery without claiming success', async () => {
    const { service, analytics } = makeService(false);

    const result = await service.submitFeedback(dto, '127.0.0.1');

    expect(result.emailSent).toBe(false);
    expect(analytics.trackFeedbackEmailSent).not.toHaveBeenCalled();
  });
});
