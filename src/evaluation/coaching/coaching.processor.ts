import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BehavioralReport,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';
import { EvaluationCoachingService } from './coaching.service';

export const EVALUATION_COACHING_QUEUE = 'evaluation-coaching';

export const GENERATE_PRE_TRADE_COACHING_JOB = 'generate-pre-trade-coaching';
export const GENERATE_POST_TRADE_COACHING_JOB = 'generate-post-trade-coaching';
export const GENERATE_BEHAVIORAL_SUMMARY_JOB = 'generate-behavioral-summary';

/** Job for pre-trade coaching → pre_trade_evaluations.ai_coaching. */
export interface PreTradeCoachingJobData {
  evaluationId: string;
  language: string;
  evaluation: PreTradeEvaluationResult;
}

/** Job for post-trade coaching → trade_verdicts.ai_coaching. */
export interface PostTradeCoachingJobData {
  verdictId: string;
  language: string;
  verdict: TradeVerdict;
}

/** Job for behavioral summary → behavioral_reports.ai_summary. */
export interface BehavioralSummaryJobData {
  reportId: string;
  language: string;
  report: BehavioralReport;
}

/**
 * Generates Phase 2 AI coaching off the request path and persists it to the
 * correct column (spec Section 9 + 10):
 *   - GENERATE_PRE_TRADE_COACHING_JOB  → pre_trade_evaluations.ai_coaching
 *   - GENERATE_POST_TRADE_COACHING_JOB → trade_verdicts.ai_coaching
 *   - GENERATE_BEHAVIORAL_SUMMARY_JOB  → behavioral_reports.ai_summary
 *
 * On provider failure the service returns null and we leave the column null
 * (the client handles null), mirroring the Phase 1 risk-coaching processor.
 * Writes are idempotent: re-running a job just re-writes the same column, so the
 * job is safe to retry.
 */
@Processor(EVALUATION_COACHING_QUEUE)
export class EvaluationCoachingProcessor extends WorkerHost {
  private readonly logger = new Logger(EvaluationCoachingProcessor.name);

  constructor(
    private readonly coachingService: EvaluationCoachingService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(
    job: Job<
      | PreTradeCoachingJobData
      | PostTradeCoachingJobData
      | BehavioralSummaryJobData
    >,
  ): Promise<void> {
    switch (job.name) {
      case GENERATE_PRE_TRADE_COACHING_JOB:
        return this.handlePreTrade(job.data as PreTradeCoachingJobData);
      case GENERATE_POST_TRADE_COACHING_JOB:
        return this.handlePostTrade(job.data as PostTradeCoachingJobData);
      case GENERATE_BEHAVIORAL_SUMMARY_JOB:
        return this.handleBehavioral(job.data as BehavioralSummaryJobData);
      default:
        this.logger.warn(`Unknown coaching job: ${job.name}`);
    }
  }

  private async handlePreTrade(data: PreTradeCoachingJobData): Promise<void> {
    const coaching = await this.coachingService.generateCoaching(
      { type: 'pre_trade', evaluation: data.evaluation },
      data.language,
    );
    if (!coaching) {
      this.logger.warn(
        `No pre-trade coaching generated for evaluation ${data.evaluationId}`,
      );
      return;
    }
    await this.prisma.preTradeEvaluation.update({
      where: { id: data.evaluationId },
      data: { aiCoaching: coaching },
    });
  }

  private async handlePostTrade(data: PostTradeCoachingJobData): Promise<void> {
    const coaching = await this.coachingService.generateCoaching(
      { type: 'post_trade', verdict: data.verdict },
      data.language,
    );
    if (!coaching) {
      this.logger.warn(
        `No post-trade coaching generated for verdict ${data.verdictId}`,
      );
      return;
    }
    await this.prisma.tradeVerdict.update({
      where: { id: data.verdictId },
      data: { aiCoaching: coaching },
    });
  }

  private async handleBehavioral(
    data: BehavioralSummaryJobData,
  ): Promise<void> {
    const summary = await this.coachingService.generateCoaching(
      { type: 'behavioral', report: data.report },
      data.language,
    );
    if (!summary) {
      this.logger.warn(
        `No behavioral summary generated for report ${data.reportId}`,
      );
      return;
    }
    await this.prisma.behavioralReport.update({
      where: { id: data.reportId },
      data: { aiSummary: summary },
    });
  }
}
