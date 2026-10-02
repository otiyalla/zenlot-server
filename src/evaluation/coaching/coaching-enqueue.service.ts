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

  /**
   * How long a terminally failed job is kept. It blocks a same-id re-enqueue
   * for this long, so repeated report reads cannot turn into repeated provider
   * calls while the provider is still unavailable.
   */
  private static readonly FAILED_JOB_COOLDOWN_SECONDS = 15 * 60;

  private async enqueue(
    jobName: string,
    data:
      | PreTradeCoachingJobData
      | PostTradeCoachingJobData
      | BehavioralSummaryJobData,
    contextId: string,
  ): Promise<void> {
    const jobId = `${jobName}-${contextId}`;
    try {
      await this.discardExpiredFailedJob(jobId);
      await this.queue.add(jobName, data, {
        // Reads may re-enqueue reports whose summary is still missing. A stable
        // id makes that recovery path idempotent while a job is queued/running.
        jobId,
        // `attempts: 3` comes from the app-level BullMQ defaults. Space those
        // attempts out so a transient provider outage has time to recover.
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        // Keep a terminal failure for the cooldown so reads during it collide
        // with the retained id and make no provider calls — otherwise retry
        // frequency would track read traffic and hammer a provider that is
        // still down. The failure itself is recorded by the processor's logger
        // and Sentry. This age is housekeeping only; discardExpiredFailedJob
        // above is what actually guarantees recovery (see its comment).
        removeOnFail: {
          age: EvaluationCoachingEnqueueService.FAILED_JOB_COOLDOWN_SECONDS,
        },
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

  /**
   * Drops a terminally failed job once it is older than the cooldown, so the
   * caller's `add` creates fresh work instead of being swallowed as a duplicate
   * id. BullMQ's own `removeOnFail: { age }` cannot be relied on for this: it
   * is applied lazily while another job moves to completed/failed, never on
   * `add`. On a quiet queue — exactly the case where a report is waiting on a
   * summary that failed — nothing else runs, so the failed job outlives its age
   * indefinitely and every later read collides with it.
   */
  private async discardExpiredFailedJob(jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    if ((await existing.getState()) !== 'failed') return;

    const cooledDownAt =
      (existing.finishedOn ?? 0) +
      EvaluationCoachingEnqueueService.FAILED_JOB_COOLDOWN_SECONDS * 1_000;
    if (Date.now() < cooledDownAt) return;

    await existing.remove();
  }
}
