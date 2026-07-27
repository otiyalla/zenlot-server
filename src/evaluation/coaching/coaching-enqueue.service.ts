import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Queue } from 'bullmq';
import {
  BehavioralReport,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';
import {
  BehavioralSummaryJobData,
  EVALUATION_COACHING_QUEUE,
  GENERATE_BEHAVIORAL_SUMMARY_JOB,
  GENERATE_POST_TRADE_COACHING_JOB,
  GENERATE_PRE_TRADE_COACHING_JOB,
  PostTradeCoachingJobData,
  PreTradeCoachingJobData,
} from './coaching.processor';

/**
 * The three Phase 2 coaching enqueue entry points (spec Section 9).
 *
 * Every method is FIRE-AND-FORGET: it swallows all errors (logging + Sentry) so
 * enqueueing coaching can never block or fail the caller's request. The
 * coaching column stays null until the async processor fills it in.
 *
 * - enqueuePreTradeCoaching   → wired into EvaluationService.submitChecklist now
 * - enqueuePostTradeCoaching  → exported, ready for Increment 2 (verdict flow)
 * - enqueueBehavioralSummary  → exported, ready for Increment 3 (report flow)
 */
@Injectable()
export class EvaluationCoachingEnqueueService {
  private readonly logger = new Logger(EvaluationCoachingEnqueueService.name);

  constructor(
    @InjectQueue(EVALUATION_COACHING_QUEUE)
    private readonly queue: Queue,
  ) {}

  /** Pre-trade coaching → pre_trade_evaluations.ai_coaching. Never throws. */
  async enqueuePreTradeCoaching(
    evaluationId: string,
    evaluation: PreTradeEvaluationResult,
    language: string,
  ): Promise<void> {
    const data: PreTradeCoachingJobData = {
      evaluationId,
      evaluation,
      language,
    };
    await this.enqueue(GENERATE_PRE_TRADE_COACHING_JOB, data, evaluationId);
  }

  /** Post-trade coaching → trade_verdicts.ai_coaching. Never throws. */
  async enqueuePostTradeCoaching(
    verdictId: string,
    verdict: TradeVerdict,
    language: string,
  ): Promise<void> {
    const data: PostTradeCoachingJobData = { verdictId, verdict, language };
    await this.enqueue(GENERATE_POST_TRADE_COACHING_JOB, data, verdictId);
  }

  /** Behavioral summary → behavioral_reports.ai_summary. Never throws. */
  async enqueueBehavioralSummary(
    reportId: string,
    report: BehavioralReport,
    language: string,
  ): Promise<void> {
    const data: BehavioralSummaryJobData = { reportId, report, language };
    await this.enqueue(GENERATE_BEHAVIORAL_SUMMARY_JOB, data, reportId);
  }

  private async enqueue(
    jobName: string,
    data:
      | PreTradeCoachingJobData
      | PostTradeCoachingJobData
      | BehavioralSummaryJobData,
    contextId: string,
  ): Promise<void> {
    try {
      await this.queue.add(jobName, data, { removeOnComplete: true });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue ${jobName} for ${contextId}`,
        error as Error,
      );
      Sentry.captureException(error, {
        extra: { context: `EvaluationCoachingEnqueueService.${jobName}` },
      });
    }
  }
}
