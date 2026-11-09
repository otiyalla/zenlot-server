export const JOURNAL_REMINDER_CLAIM_LEASE_MS = 15 * 60 * 1000;

export function journalReminderClaimLeaseCutoff(now: Date): Date {
  return new Date(now.getTime() - JOURNAL_REMINDER_CLAIM_LEASE_MS);
}

export function isJournalReminderClaimActive(
  claimLocalDate: string | null,
  claimedAt: Date | null,
  now: Date,
): boolean {
  return (
    claimLocalDate !== null &&
    claimedAt !== null &&
    claimedAt >= journalReminderClaimLeaseCutoff(now)
  );
}
