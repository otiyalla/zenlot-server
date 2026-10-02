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
      await this.queue.add(jobName, data, {
        // Reads may re-enqueue reports whose summary is still missing. A stable
        // id makes that recovery path idempotent while a job is queued/running.
        jobId: `${jobName}-${contextId}`,
        // `attempts: 3` comes from the app-level BullMQ defaults. Space those
        // attempts out so a transient provider outage has time to recover.
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        // BullMQ keeps failed jobs, and an add that collides with a retained
        // id is silently dropped — so a job that exhausted its attempts during
        // an outage would block its own replacement forever and leave the
        // summary permanently empty. Dropping the terminal failure lets the
        // next read enqueue fresh work; the failure is already recorded by the
        // processor's logger and Sentry. Intermediate retries are unaffected:
        // the job is still held while it waits to run again.
        removeOnFail: true,
      });
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
