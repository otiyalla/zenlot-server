import {
  BehavioralReportService,
  isInsufficientData,
  InsufficientData,
  BehavioralReportContract,
} from './behavioral-report.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';

const USER_ID = 'u1';
const NOW = new Date('2026-06-26T12:00:00.000Z');

/**
 * Builds a persisted-trade row (with its 1-element nested include arrays) that
 * the assembler turns into one EvaluatedTrade. `overrides` patch the verdict /
 * grade / checklist to exercise specific detectors and the skip mapping.
 */
function tradeRow(
  i: number,
  overrides: {
    lucky?: boolean;
    verdict?: 'good_trade' | 'bad_trade';
    outcome?: 'win' | 'loss' | 'breakeven';
    processScore?: number;
    setupQuality?: number;
    skipped?: boolean;
    stopLogic?: string;
    entryTriggerType?: string;
    rMultiple?: number;
    hasEval?: boolean;
    hasGrade?: boolean;
    hasVerdict?: boolean;
    closedDaysAgo?: number;
    status?: string;
  } = {},
) {
  const {
    lucky = false,
    verdict = 'good_trade',
    outcome = 'win',
    processScore = 80,
    setupQuality = 80,
    skipped = false,
    stopLogic = 'logical',
    entryTriggerType = 'market',
    rMultiple = 1.5,
    hasEval = true,
    hasGrade = true,
    hasVerdict = true,
    closedDaysAgo = 1,
    status = 'closed',
  } = overrides;

  const opened = new Date(
    NOW.getTime() - closedDaysAgo * 24 * 60 * 60 * 1000 - 60 * 60 * 1000,
  );
  const closed = new Date(NOW.getTime() - closedDaysAgo * 24 * 60 * 60 * 1000);

  return {
    id: `t${i}`,
    userId: USER_ID,
    symbol: 'EURUSD',
    execution: 'buy',
    entry: 1.1,
    lot: 0.2,
    rr: 2,
    rMultiple,
    suggestedLot: 0.2,
    stopAdjustments: [],
    status,
    createdAt: opened,
    closedAt: closed,
    preTradeEvaluations: hasEval
      ? [
          {
            id: `eval-${i}`,
            tradeId: `t${i}`,
            userId: USER_ID,
            setupQualityTotal: setupQuality,
            setupQualityGrade: 'B',
            setupBreakdown: [],
            planAdherenceTotal: null,
            planAdherenceGrade: null,
            planViolations: null,
            recommendation: 'proceed',
            aiCoaching: null,
            evaluatedAt: opened,
          },
        ]
      : [],
    executionGrades: hasGrade
      ? [
          {
            id: `grade-${i}`,
            tradeId: `t${i}`,
            userId: USER_ID,
            entryQualityScore: 100,
            stopQualityScore: 90,
            stopLogic,
            exitQualityScore: 80,
            exitType: 'target_hit',
            overallExecutionScore: 85,
            gradedAt: closed,
          },
        ]
      : [],
    tradeVerdicts: hasVerdict
      ? [
          {
            id: `verdict-${i}`,
            tradeId: `t${i}`,
            userId: USER_ID,
            verdict,
            lucky,
            processScore,
            outcome,
            matrix: lucky ? 'bad_process_win' : 'good_process_win',
            coachingFocus: 'none',
            aiCoaching: null,
            createdAt: closed,
          },
        ]
      : [],
    preTradeChecklists: [
      {
        id: `cl-${i}`,
        tradeId: `t${i}`,
        userId: USER_ID,
        checklist: { entryTrigger: { type: entryTriggerType } },
        skipped,
        submittedAt: opened,
      },
    ],
  };
}

interface Mocks {
  trades?: ReturnType<typeof tradeRow>[];
  latestReport?: unknown;
  reportCreate?: jest.Mock;
  plan?: unknown;
  enqueue?: jest.Mock;
}

function makeService(m: Mocks = {}) {
  const trades = m.trades ?? [];
  const reportCreate =
    m.reportCreate ??
    jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'report-1',
        generatedAt: NOW,
        aiSummary: null,
        ...data,
      }),
    );
  const enqueue = m.enqueue ?? jest.fn().mockResolvedValue(undefined);

  const tradeFindMany = jest.fn().mockResolvedValue(trades);
  const prisma = {
    trade: { findMany: tradeFindMany },
    behavioralReport: {
      findFirst: jest.fn().mockResolvedValue(m.latestReport ?? null),
      create: reportCreate,
    },
    tradingPlan: {
      findFirst: jest.fn().mockResolvedValue(m.plan ?? null),
    },
  } as unknown as PrismaService;

  const coaching = {
    enqueueBehavioralSummary: enqueue,
  } as unknown as EvaluationCoachingEnqueueService;

  return {
    service: new BehavioralReportService(prisma, coaching),
    prisma,
    tradeFindMany,
    reportCreate,
    enqueue,
  };
}

describe('BehavioralReportService', () => {
  describe('assembleEvaluatedTrades', () => {
    it('queries every terminal settlement status used by grading', async () => {
      const { service, tradeFindMany } = makeService({
        trades: [
          tradeRow(1, { status: 'closed_in_profit' }),
          tradeRow(2, { status: 'closed_in_loss' }),
          tradeRow(3, { status: 'reached_tp' }),
          tradeRow(4, { status: 'reached_sl' }),
        ],
      });

      await service.assembleEvaluatedTrades(USER_ID);

      expect(tradeFindMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          status: {
            in: [
              'closed',
              'closed_in_profit',
              'closed_in_loss',
              'reached_tp',
              'reached_sl',
            ],
          },
        },
        include: expect.any(Object),
      });
    });

    it('maps a fully-evaluated trade including the checklistSkipped flag', async () => {
      const { service } = makeService({
        trades: [tradeRow(1, { skipped: true })],
      });
      const evaluated = await service.assembleEvaluatedTrades(USER_ID);
      expect(evaluated).toHaveLength(1);
      expect(evaluated[0].tradeId).toBe('t1');
      expect(evaluated[0].checklistSkipped).toBe(true);
      expect(evaluated[0].outcome).toBe('win');
      expect(evaluated[0].execGrade.overallExecutionScore).toBe(85);
      expect(evaluated[0].verdict.processScore).toBe(80);
      expect(evaluated[0].execGrade.entryQuality.planned).toBe('');
    });

    it.each([
      ['trailing_1BH', false],
      ['trailing_1BL', false],
      ['trailing_1BH', true],
    ])(
      'maps checklist trigger %s%s into the execution grade',
      async (entryTriggerType, skipped) => {
        const { service } = makeService({
          trades: [tradeRow(1, { entryTriggerType, skipped })],
        });

        const [evaluated] = await service.assembleEvaluatedTrades(USER_ID);

        expect(evaluated.execGrade.entryQuality.planned).toBe(
          skipped ? '' : entryTriggerType,
        );
      },
    );

    it('defaults checklistSkipped to false when no checklist present', async () => {
      const t = tradeRow(1);
      t.preTradeChecklists = [];
      const { service } = makeService({ trades: [t] });
      const [evaluated] = await service.assembleEvaluatedTrades(USER_ID);
      expect(evaluated.checklistSkipped).toBe(false);
    });

    it('excludes trades missing a pre-eval, grade, or verdict', async () => {
      const { service } = makeService({
        trades: [
          tradeRow(1),
          tradeRow(2, { hasEval: false }),
          tradeRow(3, { hasGrade: false }),
          tradeRow(4, { hasVerdict: false }),
        ],
      });
      const evaluated = await service.assembleEvaluatedTrades(USER_ID);
      expect(evaluated.map((e) => e.tradeId)).toEqual(['t1']);
    });
  });

  describe('generate', () => {
    it('returns insufficient_data and persists nothing below 10 evaluated trades', async () => {
      const trades = Array.from({ length: 9 }, (_, i) => tradeRow(i));
      const { service, reportCreate } = makeService({ trades });
      const result = await service.generate(USER_ID, 90, 'en', NOW);
      expect(isInsufficientData(result)).toBe(true);
      const insufficient = result as InsufficientData;
      expect(insufficient.tradesRequired).toBe(10);
      expect(insufficient.tradesEvaluated).toBe(9);
      expect(reportCreate).not.toHaveBeenCalled();
    });

    it('persists a report at exactly 10 evaluated trades', async () => {
      const trades = Array.from({ length: 10 }, (_, i) => tradeRow(i));
      const { service, reportCreate } = makeService({ trades });
      const result = await service.generate(USER_ID, 90, 'en', NOW);
      expect(isInsufficientData(result)).toBe(false);
      expect(reportCreate).toHaveBeenCalledTimes(1);
      expect((result as BehavioralReportContract).tradesAnalyzed).toBe(10);
    });

    it('enqueues behavioral-summary coaching only when ≥1 pattern detected', async () => {
      // 10 lucky bad_process_win trades → lucky_streak fires.
      const trades = Array.from({ length: 10 }, (_, i) =>
        tradeRow(i, { lucky: true, verdict: 'bad_trade', processScore: 30 }),
      );
      const { service, enqueue } = makeService({ trades });
      const result = (await service.generate(
        USER_ID,
        90,
        'en',
        NOW,
      )) as BehavioralReportContract;
      expect(result.patterns.length).toBeGreaterThan(0);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        'report-1',
        expect.objectContaining({ patterns: expect.any(Array) }),
        'en',
      );
    });

    it('does NOT enqueue coaching when no pattern is detected', async () => {
      // 10 clean good trades → no pattern.
      const trades = Array.from({ length: 10 }, (_, i) => tradeRow(i));
      const { service, enqueue } = makeService({ trades });
      const result = (await service.generate(
        USER_ID,
        90,
        'en',
        NOW,
      )) as BehavioralReportContract;
      expect(result.patterns).toHaveLength(0);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('enqueue failure never throws out of generate (fire-and-forget)', async () => {
      const trades = Array.from({ length: 10 }, (_, i) =>
        tradeRow(i, { lucky: true, verdict: 'bad_trade', processScore: 30 }),
      );
      const enqueue = jest.fn().mockRejectedValue(new Error('redis down'));
      const { service } = makeService({ trades, enqueue });
      await expect(
        service.generate(USER_ID, 90, 'en', NOW),
      ).resolves.toBeDefined();
    });

    it('reads maxTradesPerDay off the current plan for overtrading', async () => {
      const { service, prisma } = makeService({
        trades: [tradeRow(1)],
        plan: { sessionRules: { maxTradesPerDay: 2 } },
      });
      await service.generate(USER_ID, 90, 'en', NOW);
      expect(prisma.tradingPlan.findFirst).toHaveBeenCalled();
    });
  });

  describe('getOrGenerate (staleness)', () => {
    it('returns the stored report when fresh (no regeneration)', async () => {
      const fresh = {
        id: 'report-fresh',
        userId: USER_ID,
        tradesAnalyzed: 12,
        periodDays: 90,
        patterns: [],
        stats: {},
        topPriority: null,
        aiSummary: 'cached',
        generatedAt: new Date(NOW.getTime() - 60 * 60 * 1000), // 1h old
      };
      const { service, reportCreate } = makeService({ latestReport: fresh });
      const result = (await service.getOrGenerate(
        USER_ID,
        90,
        'en',
        NOW,
      )) as BehavioralReportContract;
      expect(result.id).toBe('report-fresh');
      expect(result.summary).toBe('cached');
      expect(reportCreate).not.toHaveBeenCalled();
    });

    it('regenerates when the stored report is stale (> 24h)', async () => {
      const stale = {
        id: 'report-stale',
        userId: USER_ID,
        tradesAnalyzed: 12,
        periodDays: 90,
        patterns: [],
        stats: {},
        topPriority: null,
        aiSummary: null,
        generatedAt: new Date(NOW.getTime() - 48 * 60 * 60 * 1000), // 2d old
      };
      const trades = Array.from({ length: 11 }, (_, i) => tradeRow(i));
      const { service, reportCreate } = makeService({
        latestReport: stale,
        trades,
      });
      const result = (await service.getOrGenerate(
        USER_ID,
        90,
        'en',
        NOW,
      )) as BehavioralReportContract;
      expect(reportCreate).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('report-1');
    });

    it('generates fresh when no report exists yet', async () => {
      const trades = Array.from({ length: 11 }, (_, i) => tradeRow(i));
      const { service, reportCreate } = makeService({
        latestReport: null,
        trades,
      });
      await service.getOrGenerate(USER_ID, 90, 'en', NOW);
      expect(reportCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('statsSummary', () => {
    it('aggregates across all evaluated trades', async () => {
      const trades = [
        tradeRow(1, { outcome: 'win', rMultiple: 2, processScore: 90 }),
        tradeRow(2, {
          outcome: 'loss',
          rMultiple: -1,
          processScore: 70,
          verdict: 'good_trade',
        }),
        tradeRow(3, {
          outcome: 'win',
          rMultiple: 1,
          lucky: true,
          verdict: 'bad_trade',
        }),
      ];
      const { service } = makeService({ trades });
      const stats = await service.statsSummary(USER_ID);
      expect(stats.tradesEvaluated).toBe(3);
      expect(stats.winRate).toBeCloseTo(2 / 3, 2);
      expect(stats.luckyTradeRate).toBeCloseTo(1 / 3, 2);
      expect(stats.avgRMultiple).toBeCloseTo((2 - 1 + 1) / 3, 2);
      expect(stats.avgProcessScore).toBeGreaterThan(0);
      expect(stats.goodTradeRate).toBeCloseTo(2 / 3, 2);
    });

    it('returns zeros for a user with no evaluated trades', async () => {
      const { service } = makeService({ trades: [] });
      const stats = await service.statsSummary(USER_ID);
      expect(stats).toEqual({
        avgProcessScore: 0,
        goodTradeRate: 0,
        luckyTradeRate: 0,
        winRate: 0,
        avgRMultiple: 0,
        tradesEvaluated: 0,
      });
    });
  });
});
