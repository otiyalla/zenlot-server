import { NotFoundException } from '@nestjs/common';
import { PostTradeGradingService } from './post-trade-grading.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';
import { PreTradeChecklist } from './engine';

const USER_ID = 'u1';
const TRADE_ID = 't1';

// A clean, closed-in-profit long that hit its take-profit.
const tradeRow = {
  id: TRADE_ID,
  userId: USER_ID,
  symbol: 'EURUSD',
  execution: 'buy',
  entry: 1.1,
  lot: 0.2,
  rr: 2,
  stopLoss: { value: 1.095, pips: 50 },
  takeProfit: { value: 1.11, pips: 100 },
  closedPrice: 1.11,
  rMultiple: 2,
  stopAdjustments: [],
  suggestedLot: 0.2,
  status: 'closed_in_profit',
  createdAt: new Date('2026-06-26T00:00:00.000Z'),
  closedAt: new Date('2026-06-26T01:00:00.000Z'),
};

// A strong checklist (objective trigger, logical stop) stored as the JSON blob.
const checklistJson: Partial<PreTradeChecklist> = {
  entryTrigger: { type: 'trailing_1BH', note: '' },
  stopPlacement: { logic: 'swing_extreme', note: '' },
};

// A persisted pre-trade evaluation row (high setup quality, no plan).
const preEvalRow = {
  id: 'eval-1',
  tradeId: TRADE_ID,
  userId: USER_ID,
  setupQualityTotal: 90,
  setupQualityGrade: 'A',
  setupBreakdown: [],
  planAdherenceTotal: null,
  planAdherenceGrade: null,
  planViolations: null,
  recommendation: 'proceed',
  aiCoaching: null,
  evaluatedAt: new Date('2026-06-26T00:00:00.000Z'),
};

interface Mocks {
  tradeFindFirst?: jest.Mock;
  checklistFindFirst?: jest.Mock;
  preEvalFindFirst?: jest.Mock;
  execCreate?: jest.Mock;
  verdictCreate?: jest.Mock;
  execFindFirst?: jest.Mock;
  verdictFindFirst?: jest.Mock;
  enqueuePostTradeCoaching?: jest.Mock;
}

function makeService(m: Mocks = {}) {
  const tradeFindFirst =
    m.tradeFindFirst ?? jest.fn().mockResolvedValue(tradeRow);
  const checklistFindFirst =
    m.checklistFindFirst ??
    jest.fn().mockResolvedValue({ checklist: checklistJson, skipped: false });
  const preEvalFindFirst =
    m.preEvalFindFirst ?? jest.fn().mockResolvedValue(preEvalRow);
  const execCreate =
    m.execCreate ?? jest.fn().mockResolvedValue({ id: 'exec-1' });
  const verdictCreate =
    m.verdictCreate ?? jest.fn().mockResolvedValue({ id: 'verdict-1' });
  const execFindFirst = m.execFindFirst ?? jest.fn();
  const verdictFindFirst = m.verdictFindFirst ?? jest.fn();

  const prisma = {
    trade: { findFirst: tradeFindFirst },
    preTradeChecklist: { findFirst: checklistFindFirst },
    preTradeEvaluation: { findFirst: preEvalFindFirst },
    executionGrade: { create: execCreate, findFirst: execFindFirst },
    tradeVerdict: { create: verdictCreate, findFirst: verdictFindFirst },
  } as unknown as PrismaService;

  const enqueuePostTradeCoaching =
    m.enqueuePostTradeCoaching ?? jest.fn().mockResolvedValue(undefined);
  const coaching = {
    enqueuePostTradeCoaching,
  } as unknown as EvaluationCoachingEnqueueService;

  const service = new PostTradeGradingService(prisma, coaching);
  return {
    service,
    tradeFindFirst,
    checklistFindFirst,
    preEvalFindFirst,
    execCreate,
    verdictCreate,
    execFindFirst,
    verdictFindFirst,
    enqueuePostTradeCoaching,
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('PostTradeGradingService.gradeClosedTrade', () => {
  it('computes + persists execution grade and verdict with a linked checklist', async () => {
    const { service, execCreate, verdictCreate } = makeService();

    await service.gradeClosedTrade(USER_ID, TRADE_ID, 'en');

    expect(execCreate).toHaveBeenCalledTimes(1);
    const execData = execCreate.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(execData.tradeId).toBe(TRADE_ID);
    expect(execData.exitType).toBe('target_hit');
    expect(execData.stopLogic).toBe('logical');
    // Objective entry + logical stop + target hit ⇒ a perfect execution grade.
    expect(execData.overallExecutionScore).toBe(100);

    expect(verdictCreate).toHaveBeenCalledTimes(1);
    const verdictData = verdictCreate.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(verdictData.outcome).toBe('win');
    expect(verdictData.verdict).toBe('good_trade');
    expect(verdictData.matrix).toBe('good_process_win');
    expect(verdictData.lucky).toBe(false);
  });

  it('grades execution with a NEUTRAL checklist when the checklist was skipped', async () => {
    // No linked, non-skipped checklist row.
    const { service, execCreate, verdictCreate } = makeService({
      checklistFindFirst: jest.fn().mockResolvedValue(null),
    });

    await service.gradeClosedTrade(USER_ID, TRADE_ID);

    expect(execCreate).toHaveBeenCalledTimes(1);
    const execData = execCreate.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    // Neutral checklist ⇒ market entry (subjective) + arbitrary declared stop.
    // No stop adjustments, so stop logic is the declared 'arbitrary'.
    expect(execData.stopLogic).toBe('arbitrary');
    // Verdict is still computed because the pre-eval exists.
    expect(verdictCreate).toHaveBeenCalledTimes(1);
  });

  it('persists the execution grade but SKIPS the verdict when no pre-eval exists', async () => {
    const { service, execCreate, verdictCreate, enqueuePostTradeCoaching } =
      makeService({
        preEvalFindFirst: jest.fn().mockResolvedValue(null),
      });

    await service.gradeClosedTrade(USER_ID, TRADE_ID);

    expect(execCreate).toHaveBeenCalledTimes(1);
    expect(verdictCreate).not.toHaveBeenCalled();
    expect(enqueuePostTradeCoaching).not.toHaveBeenCalled();
  });

  it('enqueues post-trade coaching after the verdict is persisted', async () => {
    const { service, enqueuePostTradeCoaching } = makeService();

    await service.gradeClosedTrade(USER_ID, TRADE_ID, 'fr');
    await flush();

    expect(enqueuePostTradeCoaching).toHaveBeenCalledTimes(1);
    const [verdictId, verdict, language] =
      enqueuePostTradeCoaching.mock.calls[0];
    expect(verdictId).toBe('verdict-1');
    expect(verdict.verdict).toBe('good_trade');
    expect(language).toBe('fr');
  });

  it('never throws when persistence fails (best-effort, close already committed)', async () => {
    const { service } = makeService({
      execCreate: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      service.gradeClosedTrade(USER_ID, TRADE_ID),
    ).resolves.toBeUndefined();
  });

  it('never throws when the coaching enqueue rejects (.catch-guarded)', async () => {
    const { service, verdictCreate } = makeService({
      enqueuePostTradeCoaching: jest
        .fn()
        .mockRejectedValue(new Error('queue down')),
    });

    await expect(
      service.gradeClosedTrade(USER_ID, TRADE_ID),
    ).resolves.toBeUndefined();
    await flush();
    // The verdict was still persisted before the (failed) enqueue.
    expect(verdictCreate).toHaveBeenCalledTimes(1);
  });

  it('returns early without throwing when the trade is not found', async () => {
    const { service, execCreate } = makeService({
      tradeFindFirst: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.gradeClosedTrade(USER_ID, TRADE_ID),
    ).resolves.toBeUndefined();
    expect(execCreate).not.toHaveBeenCalled();
  });
});

describe('PostTradeGradingService.getExecutionForTrade', () => {
  it('returns the persisted execution grade as the API contract', async () => {
    const { service } = makeService({
      execFindFirst: jest.fn().mockResolvedValue({
        tradeId: TRADE_ID,
        entryQualityScore: 100,
        stopQualityScore: 100,
        stopLogic: 'logical',
        exitQualityScore: 100,
        exitType: 'target_hit',
        overallExecutionScore: 100,
        gradedAt: new Date('2026-06-26T01:00:00.000Z'),
      }),
    });

    const result = await service.getExecutionForTrade(USER_ID, TRADE_ID);
    expect(result.tradeId).toBe(TRADE_ID);
    expect(result.overallExecutionScore).toBe(100);
    expect(result.stopQuality.logic).toBe('logical');
    expect(result.exitQuality.exitType).toBe('target_hit');
  });

  it('throws 404 when the trade has not been graded', async () => {
    const { service } = makeService({
      execFindFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getExecutionForTrade(USER_ID, TRADE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PostTradeGradingService.getVerdictForTrade', () => {
  it('returns the persisted verdict including ai_coaching', async () => {
    const { service } = makeService({
      verdictFindFirst: jest.fn().mockResolvedValue({
        verdict: 'good_trade',
        lucky: false,
        processScore: 84,
        outcome: 'win',
        matrix: 'good_process_win',
        coachingFocus: 'maintain_process',
        aiCoaching: 'Solid, disciplined trade.',
        createdAt: new Date('2026-06-26T01:00:00.000Z'),
      }),
    });

    const result = await service.getVerdictForTrade(USER_ID, TRADE_ID);
    expect(result.verdict).toBe('good_trade');
    expect(result.matrix).toBe('good_process_win');
    expect(result.aiCoaching).toBe('Solid, disciplined trade.');
  });

  it('throws 404 when no verdict exists for the trade', async () => {
    const { service } = makeService({
      verdictFindFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getVerdictForTrade(USER_ID, TRADE_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
