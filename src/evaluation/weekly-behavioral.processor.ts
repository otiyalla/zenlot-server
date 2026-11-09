import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { WeeklyBehavioralService } from './weekly-behavioral.service';

export const WEEKLY_BEHAVIORAL_QUEUE = 'weekly-behavioral';
export const RUN_WEEKLY_BEHAVIORAL_JOB = 'run-weekly-behavioral';

/**
 * Weekly behavioral-review cron (spec 13.3) — fires every Sunday at 00:00 UTC.
 * The repeatable job only triggers the sweep; WeeklyBehavioralService decides,
 * per user, whether to generate + push (10+ trades AND new-pattern-or-7-days).
 *
 * Registered with a fixed jobId so re-registration on every boot updates the
 * single repeatable schedule in place rather than accumulating duplicates —
 * mirrors the drawdown-reset / journal-reminder scheduling precedent.
 */
@Processor(WEEKLY_BEHAVIORAL_QUEUE)
export class WeeklyBehavioralProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(WeeklyBehavioralProcessor.name);

  constructor(
    private readonly weeklyService: WeeklyBehavioralService,
    @InjectQueue(WEEKLY_BEHAVIORAL_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      RUN_WEEKLY_BEHAVIORAL_JOB,
      {},
      {
        jobId: RUN_WEEKLY_BEHAVIORAL_JOB,
        // Sunday 00:00 UTC.
        repeat: { pattern: '0 0 * * 0', tz: 'UTC' },
      },
    );
  }

  async process(): Promise<void> {
    this.logger.log('Running weekly behavioral review sweep');
    await this.weeklyService.runWeeklySweep();
  }
}
