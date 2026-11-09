import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  SCAN_OPEN_TRADES_JOB,
  TRADE_AUTO_CLOSE_QUEUE,
  TradeAutoCloseService,
} from './trade-auto-close.service';

@Processor(TRADE_AUTO_CLOSE_QUEUE)
export class TradeAutoCloseProcessor extends WorkerHost {
  constructor(private readonly autoCloseService: TradeAutoCloseService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === SCAN_OPEN_TRADES_JOB) {
      await this.autoCloseService.scanOpenTrades();
    }
  }
}
