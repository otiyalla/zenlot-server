/**
 * Notification categories. Each maps 1:1 to a toggle on
 * {@link notificationPreference} so a user can mute a category without muting
 * push entirely. Keep these keys stable — they are persisted (preferences) and
 * sent to the client in the push `data.category` for deep linking.
 */
export enum NotificationCategory {
  TradeClosed = 'tradeClosed',
  CoachingReady = 'coachingReady',
  DrawdownAlert = 'drawdownAlerts',
  GovernanceAlert = 'governanceAlerts',
  JournalReminder = 'journalReminders',
  BehavioralReport = 'behavioralReports',
}

/**
 * Urgency governs quiet-hours behaviour. Urgent notifications (a real-money
 * event the trader asked to be told about — a position auto-closing) still fire
 * inside quiet hours; gentle nudges (journaling reminders, coaching) are
 * suppressed until the window ends.
 */
export type NotificationUrgency = 'urgent' | 'gentle';

/** Locales the copy builder supports; falls back to 'en' for anything else. */
export type NotificationLocale = 'en' | 'fr' | 'es';

/**
 * A resolved, user-facing notification ready to hand to the Expo push pipeline.
 * `data` is the JSON payload delivered to the device and used for deep linking.
 */
export interface NotificationContent {
  category: NotificationCategory;
  urgency: NotificationUrgency;
  title: string;
  body: string;
  /** Deep-link payload — see the client's notification-response handler. */
  data: Record<string, string>;
}

/** Maps a category to the preference column that gates it. */
export const CATEGORY_PREFERENCE_KEY: Record<NotificationCategory, string> = {
  [NotificationCategory.TradeClosed]: 'tradeClosed',
  [NotificationCategory.CoachingReady]: 'coachingReady',
  [NotificationCategory.DrawdownAlert]: 'drawdownAlerts',
  [NotificationCategory.GovernanceAlert]: 'governanceAlerts',
  [NotificationCategory.JournalReminder]: 'journalReminders',
  [NotificationCategory.BehavioralReport]: 'behavioralReports',
};
