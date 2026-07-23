import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DrawdownService } from './drawdown.service';

export const DRAWDOWN_RESET_QUEUE = 'risk-drawdown-reset';
export const RESET_CIRCUIT_BREAKERS_JOB = 'reset-circuit-breakers';

/**
 * Triggers the drawdown circuit-breaker reset hourly (spec §11.4). The job only
 * fires the trigger; DrawdownService.resetCircuitBreakers decides per user
 * whether their local day/week/month has rolled over (using their IANA
 * timezone), so each user resets at their own local midnight rather than 00:00
 * UTC. Running hourly covers every whole-hour offset; the per-user
 * `lastResetLocalDate` guard keeps it to one reset per local day.
 */
@Processor(DRAWDOWN_RESET_QUEUE)
export class DrawdownResetProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DrawdownResetProcessor.name);

  constructor(
    private readonly drawdownService: DrawdownService,
    @InjectQueue(DRAWDOWN_RESET_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      RESET_CIRCUIT_BREAKERS_JOB,
      {},
      {
        jobId: RESET_CIRCUIT_BREAKERS_JOB,
        repeat: { pattern: '0 * * * *', tz: 'UTC' },
      },
    );
  }

  async process(): Promise<void> {
    this.logger.log('Running drawdown circuit-breaker reset');
    await this.drawdownService.resetCircuitBreakers();
  }
}
