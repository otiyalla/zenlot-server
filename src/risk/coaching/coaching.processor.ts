import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QuoteGateway } from '../../quote/quote.gateway';
import { GovernanceResult } from '../engine';
import { RiskCalculationView } from '../risk.mapper';
import { CoachingService } from './coaching.service';
import { NotificationsService } from '../../notifications/notifications.service';

export const COACHING_QUEUE = 'risk-coaching';
export const GENERATE_COACHING_JOB = 'generate-coaching';

export interface CoachingJobData {
  governanceLogId: string;
  tradeId: string;
  userId: string;
  language: string;
  accountCurrency: string;
  calculation: RiskCalculationView;
  governance: GovernanceResult;
}

/**
 * Generates AI coaching for a logged trade off the request path: persist it to
 * the governance log and push it to the trader over WebSocket. Failures are
 * swallowed (coaching is non-blocking) so the job does not retry forever on,
 * e.g., a provider outage.
 */
@Processor(COACHING_QUEUE)
export class CoachingProcessor extends WorkerHost {
  private readonly logger = new Logger(CoachingProcessor.name);

  constructor(
    private readonly coachingService: CoachingService,
    private readonly prisma: PrismaService,
    private readonly quoteGateway: QuoteGateway,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<CoachingJobData>): Promise<void> {
    const {
      governanceLogId,
      tradeId,
      userId,
      language,
      accountCurrency,
      calculation,
      governance,
    } = job.data;

    const coaching = await this.coachingService.generateCoaching(
      { calculation, governance, accountCurrency },
      language,
    );

    if (!coaching) {
      this.logger.warn(
        `No coaching generated for governance log ${governanceLogId}`,
      );
      return;
    }

    await this.prisma.governanceLog.update({
      where: { id: governanceLogId },
      data: { aiCoaching: coaching },
    });
    this.quoteGateway.emitCoachingReady(userId, {
      governanceLogId,
      tradeId,
      coaching,
    });

    // Push: coaching ready. The WebSocket emit above only reaches a foreground
    // device; this delivers when the app is backgrounded/closed. Best-effort.
    void this.notifications.notifyCoachingReady(userId, {
      tradeId,
      governanceLogId,
      symbol: calculation.symbol,
      coaching,
    });
  }
}
