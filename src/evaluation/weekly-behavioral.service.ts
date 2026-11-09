import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { behavioralReport } from '../../prisma/generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { BehavioralPatternKey } from '../notifications/notification.copy';
import {
  BehavioralReportService,
  isInsufficientData,
} from './behavioral-report.service';
import { BehavioralPattern, DEFAULT_PERIOD_DAYS } from './engine';

/**
 * Weekly behavioral-review sweep (spec 13.3). Runs every Sunday 00:00 UTC. For
 * each user it generates a fresh report and sends ONE push only when:
 *   - the user has 10+ evaluated trades (enforced by BehavioralReportService —
 *     generate returns insufficient_data and we skip), AND
 *   - at least one NEW pattern appeared since the previous report, OR the
 *     previous report is more than 7 days old (or there is no previous report).
 *
 * Users below 10 evaluated trades receive no notification — surfacing an empty
 * report has no value (spec 13.3). The push respects notificationPreference via
 * NotificationsService.dispatch (master switch, the behavioralReports toggle,
 * and quiet hours for this gentle notification).
 *
 * Best-effort per user: a failure for one user is logged + reported and never
 * aborts the sweep.
 */
@Injectable()
export class WeeklyBehavioralService {
  private readonly logger = new Logger(WeeklyBehavioralService.name);

  /** Previous report older than this makes the user push-eligible regardless. */
  static readonly STALE_REPORT_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportService: BehavioralReportService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Runs the weekly sweep. Iterates every user that has at least one verdict
   * (the cheapest proxy for "has evaluated trades" — the real 10-trade gate is
   * applied per user by the report generator).
   */
  async runWeeklySweep(now: Date = new Date()): Promise<void> {
    const candidates = await this.prisma.tradeVerdict.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });

    for (const { userId } of candidates) {
      try {
        await this.processUser(userId, now);
      } catch (error) {
        this.logger.warn(`Weekly behavioral sweep failed for user ${userId}`);
        Sentry.captureException(error, {
          extra: {
            userId,
            context: 'WeeklyBehavioralService.processUser',
          },
        });
      }
    }
  }

  /**
   * Generates a fresh report for one user and pushes when eligible. Returns true
   * when a push was dispatched (useful for tests/metrics).
   */
  async processUser(userId: string, now: Date = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { language: true },
    });
    const language = user?.language ?? 'en';

    // Capture the previous report BEFORE generating the new one, so we can
    // compare pattern sets and report age.
    const previous = await this.prisma.behavioralReport.findFirst({
      where: { userId, periodDays: DEFAULT_PERIOD_DAYS },
      orderBy: { generatedAt: 'desc' },
    });

    const result = await this.reportService.generate(
      userId,
      DEFAULT_PERIOD_DAYS,
      language,
      now,
    );

    // <10 evaluated trades → no report row, no notification (spec 13.3).
    if (isInsufficientData(result)) return false;

    if (!this.shouldNotify(previous, result.patterns, now)) return false;

    await this.notifications.notifyBehavioralReport(userId, {
      reportId: result.id,
      topPriority: result.topPriority as BehavioralPatternKey | null,
    });
    return true;
  }

  /**
   * Eligibility (spec 13.3): notify when a new pattern was detected since the
   * previous report OR the previous report is more than 7 days old (or absent).
   */
  shouldNotify(
    previous: behavioralReport | null,
    currentPatterns: BehavioralPattern[],
    now: Date,
  ): boolean {
    if (!previous) return currentPatterns.length > 0;

    const ageDays =
      (now.getTime() - previous.generatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > WeeklyBehavioralService.STALE_REPORT_DAYS) {
      return currentPatterns.length > 0;
    }

    const previousTypes = new Set(
      ((previous.patterns as unknown as BehavioralPattern[]) ?? []).map(
        (p) => p.type,
      ),
    );
    return currentPatterns.some((p) => !previousTypes.has(p.type));
  }
}
