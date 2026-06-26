import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JournalReminderService } from './journal-reminder.service';

export const JOURNAL_REMINDER_QUEUE = 'journal-reminder';
export const SEND_JOURNAL_REMINDERS_JOB = 'send-journal-reminders';

/**
 * Triggers the daily journaling nudge hourly. The job only fires the trigger;
 * JournalReminderService decides per user whether their local reminder hour has
 * arrived and whether they have already been reminded today (via their IANA
 * timezone). Running hourly covers every whole-hour UTC offset; the per-user
 * `lastReminderLocalDate` guard keeps it to one reminder per local day. Mirrors
 * the drawdown-reset scheduling pattern.
 */
@Processor(JOURNAL_REMINDER_QUEUE)
export class JournalReminderProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(JournalReminderProcessor.name);

  constructor(
    private readonly reminderService: JournalReminderService,
    @InjectQueue(JOURNAL_REMINDER_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      SEND_JOURNAL_REMINDERS_JOB,
      {},
      {
        jobId: SEND_JOURNAL_REMINDERS_JOB,
        repeat: { pattern: '0 * * * *', tz: 'UTC' },
      },
    );
  }

  async process(): Promise<void> {
    this.logger.log('Running journaling reminder sweep');
    await this.reminderService.sendDueReminders();
  }
}
