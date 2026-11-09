import { WeeklyBehavioralService } from './weekly-behavioral.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BehavioralReportContract,
  BehavioralReportService,
  InsufficientData,
} from './behavioral-report.service';
import { BehavioralPattern } from './engine';

const USER_ID = 'u1';
const NOW = new Date('2026-06-28T00:00:00.000Z'); // a Sunday

function pattern(type: string): BehavioralPattern {
  return {
    type: type as BehavioralPattern['type'],
    severity: 'warning',
    confidence: 0.5,
    sampleSize: 5,
    totalTrades: 10,
    evidence: [],
    metric: 'metric',
  };
}

function report(
  patterns: BehavioralPattern[],
  topPriority: string | null = patterns[0]?.type ?? null,
): BehavioralReportContract {
  return {
    id: 'report-new',
    userId: USER_ID,
    generatedAt: NOW.toISOString(),
    tradesAnalyzed: 12,
    periodDays: 90,
    patterns,
    stats: {} as BehavioralReportContract['stats'],
    topPriority: topPriority as BehavioralReportContract['topPriority'],
    summary: null,
  };
}

const INSUFFICIENT: InsufficientData = {
  insufficientData: true,
  tradesRequired: 10,
  tradesEvaluated: 4,
};

interface Mocks {
  previousReport?: unknown;
  generateResult?: BehavioralReportContract | InsufficientData;
  notify?: jest.Mock;
  generate?: jest.Mock;
  candidates?: { userId: string }[];
}

function makeService(m: Mocks = {}) {
  const notify = m.notify ?? jest.fn().mockResolvedValue(undefined);
  const generate =
    m.generate ??
    jest
      .fn()
      .mockResolvedValue(m.generateResult ?? report([pattern('early_exit')]));

  const prisma = {
    tradeVerdict: {
      findMany: jest
        .fn()
        .mockResolvedValue(m.candidates ?? [{ userId: USER_ID }]),
    },
    behavioralReport: {
      findFirst: jest.fn().mockResolvedValue(m.previousReport ?? null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ language: 'en' }),
    },
  } as unknown as PrismaService;

  const reportService = {
    generate,
  } as unknown as BehavioralReportService;

  const notifications = {
    notifyBehavioralReport: notify,
  } as unknown as NotificationsService;

  return {
    service: new WeeklyBehavioralService(prisma, reportService, notifications),
    notify,
    generate,
    prisma,
  };
}

describe('WeeklyBehavioralService', () => {
  describe('shouldNotify', () => {
    const svc = makeService().service;

    it('notifies when no previous report and patterns exist', () => {
      expect(svc.shouldNotify(null, [pattern('early_exit')], NOW)).toBe(true);
    });

    it('does NOT notify when no previous report and no patterns', () => {
      expect(svc.shouldNotify(null, [], NOW)).toBe(false);
    });

    it('notifies when a previous report > 7 days old and patterns exist', () => {
      const prev = {
        generatedAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
        patterns: [pattern('early_exit')],
      } as never;
      expect(svc.shouldNotify(prev, [pattern('early_exit')], NOW)).toBe(true);
    });

    it('notifies when a NEW pattern type appears within 7 days', () => {
      const prev = {
        generatedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
        patterns: [pattern('early_exit')],
      } as never;
      expect(svc.shouldNotify(prev, [pattern('overtrading')], NOW)).toBe(true);
    });

    it('does NOT notify when recent report has the same patterns', () => {
      const prev = {
        generatedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
        patterns: [pattern('early_exit')],
      } as never;
      expect(svc.shouldNotify(prev, [pattern('early_exit')], NOW)).toBe(false);
    });
  });

  describe('processUser', () => {
    it('pushes when eligible, passing reportId + topPriority', async () => {
      const { service, notify } = makeService({
        generateResult: report([pattern('overtrading')], 'overtrading'),
      });
      const pushed = await service.processUser(USER_ID, NOW);
      expect(pushed).toBe(true);
      expect(notify).toHaveBeenCalledWith(USER_ID, {
        reportId: 'report-new',
        topPriority: 'overtrading',
      });
    });

    it('does NOT push when the user has < 10 evaluated trades', async () => {
      const { service, notify } = makeService({ generateResult: INSUFFICIENT });
      const pushed = await service.processUser(USER_ID, NOW);
      expect(pushed).toBe(false);
      expect(notify).not.toHaveBeenCalled();
    });

    it('does NOT push when not eligible (recent report, same patterns)', async () => {
      const { service, notify } = makeService({
        previousReport: {
          generatedAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
          patterns: [pattern('early_exit')],
        },
        generateResult: report([pattern('early_exit')]),
      });
      const pushed = await service.processUser(USER_ID, NOW);
      expect(pushed).toBe(false);
      expect(notify).not.toHaveBeenCalled();
    });

    it('uses the user language when generating', async () => {
      const generate = jest
        .fn()
        .mockResolvedValue(report([pattern('early_exit')]));
      const { service } = makeService({ generate });
      await service.processUser(USER_ID, NOW);
      expect(generate).toHaveBeenCalledWith(USER_ID, 90, 'en', NOW);
    });
  });

  describe('runWeeklySweep', () => {
    it('processes every candidate user and isolates failures', async () => {
      const notify = jest.fn().mockResolvedValue(undefined);
      // First user's generate throws; the sweep must isolate it and continue.
      const generate = jest
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(report([pattern('early_exit')]));
      const { service, prisma } = makeService({
        candidates: [{ userId: 'a' }, { userId: 'b' }],
        notify,
        generate,
      });

      await expect(service.runWeeklySweep(NOW)).resolves.toBeUndefined();
      const findMany = prisma.tradeVerdict.findMany;
      expect(findMany).toHaveBeenCalledWith({
        distinct: ['userId'],
        select: { userId: true },
      });
      // Second user still got a push despite the first user's failure.
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });
});
