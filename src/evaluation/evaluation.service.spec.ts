import { NotFoundException } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { PrismaService } from '../prisma/prisma.service';
import { TradingPlanService } from './trading-plan.service';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';
import { TradingPlan } from './engine';

const USER_ID = 'u1';

// A strong setup: clear momentum + confirmed reversal, high-confidence pattern,
// confluence price zone, in time zone, objective trailing trigger.
const strongChecklist: SubmitChecklistDto = {
  momentum: { higherTfDirection: 'bullish', lowerTfReversal: true, note: '' },
  pattern: {
    identified: true,
    type: 'five_wave_trend',
    confidence: 'high',
    note: '',
  },
  priceZone: {
    atSignificantLevel: true,
    levelType: 'fibonacci_retracement',
    confluence: true,
    note: '',
  },
  timeConfluence: { inTimeZone: true, note: '' },
  entryTrigger: { type: 'trailing_1BH', note: '' },
  stopPlacement: { logic: 'swing_extreme', note: '' },
  overallConfidence: 'high',
  traderNotes: 'looks clean',
};

const plan: TradingPlan = {
  userId: USER_ID,
  version: 1,
  updatedAt: '2026-06-26T00:00:00.000Z',
  entryConditions: {
    requiresMomentumAlignment: true,
    requiresPattern: true,
    requiresPriceZone: true,
    requiresTimeConfluence: false,
    requiredCandlestickSignal: false,
    customConditions: '',
  },
  stopRules: { placement: 'swing_extreme' },
  exitRules: { unit1: '1R', unit2: '2R' },
  sessionRules: {
    avoidHighImpactNews: true,
    tradingSessionsOnly: ['london'],
    maxTradesPerDay: 3,
  },
};

function makeService(opts: {
  getCurrentPlan?: jest.Mock;
  checklistCreate?: jest.Mock;
  evalCreate?: jest.Mock;
  checklistFindFirst?: jest.Mock;
  checklistUpdate?: jest.Mock;
  evalFindFirst?: jest.Mock;
  evalUpdateMany?: jest.Mock;
}) {
  const checklistCreate =
    opts.checklistCreate ?? jest.fn().mockResolvedValue({ id: 'chk-1' });
  // The persisted evaluation echoes back whatever the service wrote.
  const evalCreate =
    opts.evalCreate ??
    jest
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'eval-1',
          tradeId: null,
          evaluatedAt: new Date('2026-06-26T10:00:00Z'),
          aiCoaching: null,
          ...data,
        }),
      );
  const checklistFindFirst = opts.checklistFindFirst ?? jest.fn();
  const checklistUpdate =
    opts.checklistUpdate ?? jest.fn().mockResolvedValue({});
  const evalFindFirst = opts.evalFindFirst ?? jest.fn();
  const evalUpdateMany = opts.evalUpdateMany ?? jest.fn().mockResolvedValue({});

  const prisma = {
    preTradeChecklist: {
      create: checklistCreate,
      findFirst: checklistFindFirst,
      update: checklistUpdate,
    },
    preTradeEvaluation: {
      create: evalCreate,
      findFirst: evalFindFirst,
      updateMany: evalUpdateMany,
    },
  } as unknown as PrismaService;

  const tradingPlanService = {
    getCurrentPlan: opts.getCurrentPlan ?? jest.fn().mockResolvedValue(null),
  } as unknown as TradingPlanService;

  const service = new EvaluationService(prisma, tradingPlanService);
  return {
    service,
    checklistCreate,
    evalCreate,
    checklistFindFirst,
    checklistUpdate,
    evalFindFirst,
    evalUpdateMany,
  };
}

describe('EvaluationService.submitChecklist', () => {
  it('persists the checklist with tradeId null and not skipped', async () => {
    const { service, checklistCreate } = makeService({});
    await service.submitChecklist(USER_ID, strongChecklist, 'en');

    const arg = checklistCreate.mock.calls[0][0] as {
      data: { tradeId: null; skipped: boolean; userId: string };
    };
    expect(arg.data.tradeId).toBeNull();
    expect(arg.data.skipped).toBe(false);
    expect(arg.data.userId).toBe(USER_ID);
  });

  it('runs the engine and persists the evaluation; aiCoaching is null (no plan)', async () => {
    const { service, evalCreate } = makeService({});
    const result = await service.submitChecklist(
      USER_ID,
      strongChecklist,
      'en',
    );

    // Strong setup => grade A, high score, recommendation proceed (no plan).
    expect(result.setupQuality.grade).toBe('A');
    expect(result.setupQuality.total).toBeGreaterThanOrEqual(85);
    expect(result.planAdherence).toBeNull();
    expect(result.recommendation).toBe('proceed');
    expect(result.aiCoaching).toBeNull();
    expect(result.checklistId).toBe('chk-1');
    expect(result.tradeId).toBeNull();

    const arg = evalCreate.mock.calls[0][0] as {
      data: { planAdherenceTotal: number | null; recommendation: string };
    };
    expect(arg.data.planAdherenceTotal).toBeNull();
    expect(arg.data.recommendation).toBe('proceed');
  });

  it('scores plan adherence when a current plan exists', async () => {
    const { service, evalCreate } = makeService({
      getCurrentPlan: jest.fn().mockResolvedValue(plan),
    });
    const result = await service.submitChecklist(
      USER_ID,
      strongChecklist,
      'en',
    );

    expect(result.planAdherence).not.toBeNull();
    expect(result.planAdherence?.total).toBe(100);
    expect(result.planAdherence?.ruleBreaker).toBe(false);

    const arg = evalCreate.mock.calls[0][0] as {
      data: { planAdherenceTotal: number | null; planAdherenceGrade: string };
    };
    expect(arg.data.planAdherenceTotal).toBe(100);
    expect(arg.data.planAdherenceGrade).toBe('A');
  });
});

describe('EvaluationService.getPreEvalForTrade', () => {
  it('throws NotFound when no evaluation exists for the trade', async () => {
    const { service } = makeService({
      evalFindFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getPreEvalForTrade(USER_ID, 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps the persisted evaluation row back to the result contract', async () => {
    const { service } = makeService({
      evalFindFirst: jest.fn().mockResolvedValue({
        id: 'eval-1',
        tradeId: 't1',
        setupQualityTotal: 90,
        setupQualityGrade: 'A',
        setupBreakdown: [],
        planAdherenceTotal: null,
        planAdherenceGrade: null,
        planViolations: null,
        recommendation: 'proceed',
        aiCoaching: null,
        evaluatedAt: new Date('2026-06-26T10:00:00Z'),
      }),
      checklistFindFirst: jest.fn().mockResolvedValue({ id: 'chk-9' }),
    });

    const result = await service.getPreEvalForTrade(USER_ID, 't1');
    expect(result.tradeId).toBe('t1');
    expect(result.checklistId).toBe('chk-9');
    expect(result.setupQuality.total).toBe(90);
    expect(result.planAdherence).toBeNull();
  });
});

describe('EvaluationService soft-gate', () => {
  it('links a checklist + its evaluations to the trade', async () => {
    const { service, checklistUpdate, evalUpdateMany } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue({
        id: 'chk-1',
        userId: USER_ID,
        tradeId: null,
      }),
    });

    const linked = await service.linkChecklistToTrade(USER_ID, 't1', 'chk-1');

    expect(linked).toBe(true);
    expect(checklistUpdate).toHaveBeenCalledWith({
      where: { id: 'chk-1' },
      data: { tradeId: 't1' },
    });
    expect(evalUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, tradeId: null },
      data: { tradeId: 't1' },
    });
  });

  it('returns false (does not link) for an unknown / unowned checklist', async () => {
    const { service, checklistUpdate } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue(null),
    });
    const linked = await service.linkChecklistToTrade(USER_ID, 't1', 'chk-x');
    expect(linked).toBe(false);
    expect(checklistUpdate).not.toHaveBeenCalled();
  });

  it('records a skipped checklist row for the trade', async () => {
    const { service, checklistCreate } = makeService({});
    await service.markChecklistSkipped(USER_ID, 't1');

    const arg = checklistCreate.mock.calls[0][0] as {
      data: { tradeId: string; skipped: boolean };
    };
    expect(arg.data.tradeId).toBe('t1');
    expect(arg.data.skipped).toBe(true);
  });
});
