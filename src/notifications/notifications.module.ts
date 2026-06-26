import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ExpoPushService } from './expo-push.service';
import { PushTokenService } from './push-token.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { JournalReminderService } from './journal-reminder.service';
import {
  JOURNAL_REMINDER_QUEUE,
  JournalReminderProcessor,
} from './journal-reminder.processor';

/**
 * Push-notification subsystem (Expo). Exposes:
 *  - REST endpoints to register/unregister device tokens and manage preferences;
 *  - {@link NotificationsService} for triggers across the app to fire pushes.
 *
 * Exported so trigger sites (trade auto-close, coaching, drawdown/governance,
 * scheduled reminders) can inject NotificationsService.
 */
@Module({
  imports: [BullModule.registerQueue({ name: JOURNAL_REMINDER_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ExpoPushService,
    PushTokenService,
    NotificationPreferenceService,
    JournalReminderService,
    JournalReminderProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
