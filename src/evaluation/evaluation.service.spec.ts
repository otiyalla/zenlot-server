import { NotFoundException } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';
import { PrismaService } from '../prisma/prisma.service';
import { TradingPlanService } from './trading-plan.service';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';
import { TradingPlan } from './engine';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';

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
  checklistUpdateMany?: jest.Mock;
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
  const checklistUpdateMany =
    opts.checklistUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const evalFindFirst = opts.evalFindFirst ?? jest.fn();
  const evalUpdateMany = opts.evalUpdateMany ?? jest.fn().mockResolvedValue({});

  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    preTradeChecklist: {
      create: checklistCreate,
      findFirst: checklistFindFirst,
      update: checklistUpdate,
      updateMany: checklistUpdateMany,
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

  const enqueuePreTradeCoaching = jest.fn().mockResolvedValue(undefined);
  const coachingEnqueue = {
    enqueuePreTradeCoaching,
  } as unknown as EvaluationCoachingEnqueueService;

  const service = new EvaluationService(
    prisma,
    tradingPlanService,
    coachingEnqueue,
  );
  return {
    service,
    checklistCreate,
    evalCreate,
    checklistFindFirst,
    checklistUpdate,
    checklistUpdateMany,
    evalFindFirst,
    evalUpdateMany,
    enqueuePreTradeCoaching,
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
      data: {
        checklistId: string;
        planAdherenceTotal: number | null;
        recommendation: string;
      };
    };
    expect(arg.data.checklistId).toBe('chk-1');
    expect(arg.data.planAdherenceTotal).toBeNull();
    expect(arg.data.recommendation).toBe('proceed');
  });

  it('fires pre-trade coaching enqueue (fire-and-forget) with the finished result', async () => {
    const { service, enqueuePreTradeCoaching } = makeService({});
    await service.submitChecklist(USER_ID, strongChecklist, 'fr');

    expect(enqueuePreTradeCoaching).toHaveBeenCalledTimes(1);
    const [evaluationId, evaluation, language] =
      enqueuePreTradeCoaching.mock.calls[0];
    expect(evaluationId).toBe('eval-1');
    expect(language).toBe('fr');
    expect(evaluation.recommendation).toBe('proceed');
    expect(evaluation.aiCoaching).toBeNull();
  });

  it('does not let a coaching enqueue failure fail checklist submission', async () => {
    const { service, enqueuePreTradeCoaching } = makeService({});
    // enqueue is fire-and-forget; even a rejected promise must not surface.
    enqueuePreTradeCoaching.mockRejectedValueOnce(new Error('redis down'));
    await expect(
      service.submitChecklist(USER_ID, strongChecklist, 'en'),
    ).resolves.toBeDefined();
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
    const { service, checklistFindFirst } = makeService({
      evalFindFirst: jest.fn().mockResolvedValue({
        id: 'eval-1',
        tradeId: 't1',
        checklistId: 'chk-9',
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
    expect(checklistFindFirst).toHaveBeenCalledWith({
      where: { id: 'chk-9', userId: USER_ID, tradeId: 't1', skipped: false },
    });
    expect(result.setupQuality.total).toBe(90);
    expect(result.planAdherence).toBeNull();
  });
});

describe('EvaluationService.getEvalById', () => {
  it('throws NotFound when no evaluation with that id is owned by the user', async () => {
    const { service } = makeService({
      evalFindFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getEvalById(USER_ID, 'eval-missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the evaluation by id incl. persisted checklistId and async aiCoaching', async () => {
    const evalFindFirst = jest.fn().mockResolvedValue({
      id: 'eval-1',
      tradeId: null,
      checklistId: 'chk-1',
      setupQualityTotal: 88,
      setupQualityGrade: 'A',
      setupBreakdown: [],
      planAdherenceTotal: null,
      planAdherenceGrade: null,
      planViolations: null,
      recommendation: 'proceed',
      aiCoaching: 'Proceed. Strong confluence across all factors.',
      evaluatedAt: new Date('2026-06-27T10:00:00Z'),
    });
    const { service } = makeService({ evalFindFirst });

    const result = await service.getEvalById(USER_ID, 'eval-1');

    // Scoped to the owning user, looked up by the evaluation's own id.
    expect(evalFindFirst).toHaveBeenCalledWith({
      where: { id: 'eval-1', userId: USER_ID },
    });
    expect(result.evaluationId).toBe('eval-1');
    expect(result.checklistId).toBe('chk-1');
    expect(result.tradeId).toBeNull();
    expect(result.aiCoaching).toBe(
      'Proceed. Strong confluence across all factors.',
    );
  });
});

describe('EvaluationService soft-gate', () => {
  it('links only the evaluation belonging to the selected checklist', async () => {
    const { service, checklistUpdateMany, evalUpdateMany } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue({
        id: 'chk-1',
        userId: USER_ID,
        tradeId: null,
      }),
    });

    const linked = await service.linkChecklistToTrade(USER_ID, 't1', 'chk-1');

    expect(linked).toBe(true);
    expect(checklistUpdateMany).toHaveBeenCalledWith({
      where: { id: 'chk-1', tradeId: null },
      data: { tradeId: 't1' },
    });
    expect(evalUpdateMany).toHaveBeenCalledWith({
      where: { checklistId: 'chk-1', tradeId: null },
      data: { tradeId: 't1' },
    });
  });

  it('does not attach another pending checklist evaluation to the trade', async () => {
    const evalUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue({
        id: 'chk-2',
        userId: USER_ID,
        tradeId: null,
      }),
      evalUpdateMany,
    });

    await expect(
      service.linkChecklistToTrade(USER_ID, 't2', 'chk-2'),
    ).resolves.toBe(true);

    expect(evalUpdateMany).toHaveBeenCalledTimes(1);
    expect(evalUpdateMany).toHaveBeenCalledWith({
      where: { checklistId: 'chk-2', tradeId: null },
      data: { tradeId: 't2' },
    });
    expect(evalUpdateMany).not.toHaveBeenCalledWith({
      where: { userId: USER_ID, tradeId: null },
      data: { tradeId: 't2' },
    });
  });

  it('leaves legacy evaluations without a checklist relationship unlinked', async () => {
    const evalUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue({
        id: 'chk-legacy',
        userId: USER_ID,
        tradeId: null,
      }),
      evalUpdateMany,
    });

    await expect(
      service.linkChecklistToTrade(USER_ID, 't3', 'chk-legacy'),
    ).resolves.toBe(true);
    expect(evalUpdateMany).toHaveBeenCalledWith({
      where: { checklistId: 'chk-legacy', tradeId: null },
      data: { tradeId: 't3' },
    });
  });

  it('returns false (does not link) for an unknown / unowned checklist', async () => {
    const { service, checklistUpdateMany } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue(null),
    });
    const linked = await service.linkChecklistToTrade(USER_ID, 't1', 'chk-x');
    expect(linked).toBe(false);
    expect(checklistUpdateMany).not.toHaveBeenCalled();
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
