import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { TradeLogService } from './trade-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiskCalculationService } from './risk-calculation.service';
import { RateResolverService } from './rate-resolver.service';
import { DrawdownService } from './drawdown.service';
import { RiskProfileService } from './risk-profile.service';
import { RiskCalculationView } from './risk.mapper';
import { NotificationsService } from '../notifications/notifications.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import { PostTradeGradingService } from '../evaluation/post-trade-grading.service';

const view: RiskCalculationView = {
  symbol: 'EURUSD',
  execution: 'buy',
  instrument: 'forex',
  entry: 1.1,
  stopPrice: 1.095,
  targetPrice: 1.11,
  exchangeRate: 1,
  stopDistancePips: 50,
  pipValue: 10,
  pipSize: 0.0001,
  maxCapitalExposure: 100,
  lotSize: 0.2,
  lotSizeRounded: 0.2,
  actualCapitalExposure: 100,
  capitalExposurePct: 1,
  rewardPips: 100,
  rewardToRisk: 2,
};

const setup = {
  symbol: 'EURUSD',
  execution: 'buy' as const,
  entry: 1.1,
  stopPrice: 1.095,
  targetPrice: 1.11,
};

function makeService(opts: {
  calculate?: jest.Mock;
  tradeCreate?: jest.Mock;
  govCreate?: jest.Mock;
  queueAdd?: jest.Mock;
  findUnique?: jest.Mock;
  findFirst?: jest.Mock;
  resolveExchangeRate?: jest.Mock;
  settleRealizedPnL?: jest.Mock;
  applyBalanceDelta?: jest.Mock;
  txUpdate?: jest.Mock;
  txUpdateMany?: jest.Mock;
  txDelete?: jest.Mock;
  profileUpdate?: jest.Mock;
  profileFindUnique?: jest.Mock;
  getProfile?: jest.Mock;
  linkChecklistToTrade?: jest.Mock;
  markChecklistSkipped?: jest.Mock;
  gradeClosedTrade?: jest.Mock;
  tradeUpdate?: jest.Mock;
}) {
  const calculate =
    opts.calculate ??
    jest.fn().mockResolvedValue({
      calculation: view,
      governance: {
        overallStatus: 'approved',
        checks: [],
        blockedReason: null,
        aiCoaching: null,
      },
    });
  const tradeCreate =
    opts.tradeCreate ?? jest.fn().mockResolvedValue({ id: 't1' });
  const govCreate = opts.govCreate ?? jest.fn().mockResolvedValue({ id: 'g1' });
  const queueAdd = opts.queueAdd ?? jest.fn().mockResolvedValue(undefined);
  const txUpdate =
    opts.txUpdate ??
    jest.fn().mockResolvedValue({ id: 't1', status: 'closed_in_profit' });
  const txUpdateMany =
    opts.txUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });
  const txFindUnique = jest.fn().mockResolvedValue(undefined);
  const txDelete = opts.txDelete ?? jest.fn().mockResolvedValue({ id: 't1' });
  const profileUpdate = opts.profileUpdate ?? jest.fn().mockResolvedValue({});
  // Defaults to a present profile so the reversal path runs; tests covering the
  // no-profile case pass `profileFindUnique` returning null.
  const profileFindUnique =
    opts.profileFindUnique ?? jest.fn().mockResolvedValue({ userId: 'u1' });

  const tx = {
    trade: {
      update: txUpdate,
      updateMany: txUpdateMany,
      findUnique: txFindUnique,
      delete: txDelete,
    },
    riskProfile: { update: profileUpdate, findUnique: profileFindUnique },
    // closeTrade snapshots breach flags before/after settlement for a drawdown push.
    drawdownState: {
      findUnique: jest.fn().mockResolvedValue({
        dailyBreached: false,
        weeklyBreached: false,
        monthlyBreached: false,
      }),
    },
  };
  const tradeUpdate =
    opts.tradeUpdate ?? jest.fn().mockResolvedValue({ id: 't1' });
  const prisma = {
    trade: {
      create: tradeCreate,
      findUnique: opts.findUnique ?? jest.fn(),
      findFirst: opts.findFirst ?? jest.fn(),
      update: tradeUpdate,
    },
    governanceLog: { create: govCreate },
    $transaction: jest
      .fn()
      .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  const riskCalc = { calculate } as unknown as RiskCalculationService;
  const rateResolver = {
    resolveExchangeRate:
      opts.resolveExchangeRate ?? jest.fn().mockResolvedValue(1),
  } as unknown as RateResolverService;
  const settleRealizedPnL =
    opts.settleRealizedPnL ?? jest.fn().mockResolvedValue(undefined);
  const applyBalanceDelta =
    opts.applyBalanceDelta ?? jest.fn().mockResolvedValue(undefined);
  const drawdown = {
    settleRealizedPnL,
    applyBalanceDelta,
  } as unknown as DrawdownService;
  const profile = {
    getProfile:
      opts.getProfile ??
      jest.fn().mockResolvedValue({ overrideMode: 'simple' }),
  } as unknown as RiskProfileService;

  const coachingQueue = { add: queueAdd } as unknown as Queue;

  const linkChecklistToTrade =
    opts.linkChecklistToTrade ?? jest.fn().mockResolvedValue(true);
  const markChecklistSkipped =
    opts.markChecklistSkipped ?? jest.fn().mockResolvedValue(undefined);
  const evaluationService = {
    linkChecklistToTrade,
    markChecklistSkipped,
  } as unknown as EvaluationService;

  const gradeClosedTrade =
    opts.gradeClosedTrade ?? jest.fn().mockResolvedValue(undefined);
  const postTradeGrading = {
    gradeClosedTrade,
  } as unknown as PostTradeGradingService;

  const notifications = {
    notifyTradeClosed: jest.fn().mockResolvedValue(undefined),
    notifyGovernanceViolation: jest.fn().mockResolvedValue(undefined),
    notifyDrawdownBreach: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  const service = new TradeLogService(
    prisma,
    riskCalc,
    rateResolver,
    drawdown,
    profile,
    notifications,
    evaluationService,
    postTradeGrading,
    coachingQueue,
  );
  return {
    service,
    tradeCreate,
    govCreate,
    queueAdd,
    txUpdate,
    txUpdateMany,
    txDelete,
    profileUpdate,
    profileFindUnique,
    settleRealizedPnL,
    applyBalanceDelta,
    linkChecklistToTrade,
    markChecklistSkipped,
    gradeClosedTrade,
    tradeUpdate,
  };
}

const dataOf = (mock: jest.Mock, call = 0): Record<string, unknown> => {
  const calls = mock.mock.calls as unknown as Array<
    [{ data: Record<string, unknown> }]
  >;
  return calls[call][0].data;
};

describe('TradeLogService.logTrade', () => {
  it('persists the trade, writes a governance log, and enqueues coaching', async () => {
    const { service, tradeCreate, govCreate, queueAdd } = makeService({});
    const result = await service.logTrade('u1', 'USD', setup);

    const data = dataOf(tradeCreate);
    expect(data.symbol).toBe('EURUSD');
    expect(data.lot).toBe(0.2);
    expect(data.execution).toBe('buy');
    expect(data.capitalExposure).toBe(100);
    expect(data.governanceStatus).toBe('approved');
    expect(govCreate).toHaveBeenCalled();
    expect(queueAdd).toHaveBeenCalledWith(
      'generate-coaching',
      expect.objectContaining({
        governanceLogId: 'g1',
        tradeId: 't1',
        userId: 'u1',
      }),
      expect.any(Object),
    );
    expect(result).toEqual({ id: 't1' });
  });

  it('persists the trade journal (plainText/editorState) when provided', async () => {
    const { service, tradeCreate } = makeService({});
    await service.logTrade('u1', 'USD', {
      ...setup,
      plainText: 'My trade thesis',
      editorState: '{"blocks":[]}',
    });

    const data = dataOf(tradeCreate);
    expect(data.plainText).toBe('My trade thesis');
    expect(data.editorState).toBe('{"blocks":[]}');
  });

  it('defaults the journal to null when omitted', async () => {
    const { service, tradeCreate } = makeService({});
    await service.logTrade('u1', 'USD', setup);

    const data = dataOf(tradeCreate);
    expect(data.plainText).toBeNull();
    expect(data.editorState).toBeNull();
  });

  const blockedGovernance = {
    overallStatus: 'blocked' as const,
    checks: [
      {
        rule: 'maxPortfolioExposure',
        status: 'blocked' as const,
        actual: 5,
        limit: 3,
        message: 'Total portfolio exposure after this trade exceeds your limit',
      },
    ],
    blockedReason:
      'Total portfolio exposure after this trade exceeds your limit',
    aiCoaching: null,
  };
  const blockedCalc = () =>
    jest
      .fn()
      .mockResolvedValue({ calculation: view, governance: blockedGovernance });

  it('does not persist a blocking trade until it is acknowledged, and returns the broken rules', async () => {
    const { service, tradeCreate } = makeService({ calculate: blockedCalc() });
    await expect(service.logTrade('u1', 'USD', setup)).rejects.toMatchObject({
      response: {
        requiresAcknowledgement: true,
        overrideMode: 'simple',
        checks: [{ rule: 'maxPortfolioExposure' }],
      },
    });
    expect(tradeCreate).not.toHaveBeenCalled();
  });

  it('persists a blocking trade as overridden once acknowledged (simple mode)', async () => {
    const { service, tradeCreate, govCreate } = makeService({
      calculate: blockedCalc(),
    });
    await service.logTrade('u1', 'USD', {
      ...setup,
      acknowledged: true,
      overrideReason: 'High-conviction news play',
    });

    const tradeData = dataOf(tradeCreate);
    expect(tradeData.overridden).toBe(true);
    expect(tradeData.governanceStatus).toBe('blocked');

    const logData = dataOf(govCreate);
    expect(logData.acknowledged).toBe(true);
    expect(logData.acknowledgedRules).toEqual(['maxPortfolioExposure']);
    expect(logData.overrideReason).toBe('High-conviction news play');
  });

  it('detailed mode requires acknowledging every blocking rule', async () => {
    const getProfile = jest
      .fn()
      .mockResolvedValue({ overrideMode: 'detailed' });
    const { service, tradeCreate } = makeService({
      calculate: blockedCalc(),
      getProfile,
    });
    // A bare `acknowledged: true` is not enough in detailed mode.
    await expect(
      service.logTrade('u1', 'USD', { ...setup, acknowledged: true }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tradeCreate).not.toHaveBeenCalled();

    // Listing the blocking rule unblocks it.
    await service.logTrade('u1', 'USD', {
      ...setup,
      acknowledgedRules: ['maxPortfolioExposure'],
    });
    expect(dataOf(tradeCreate).overridden).toBe(true);
  });

  it('rejects when the position rounds to zero', async () => {
    const calculate = jest.fn().mockResolvedValue({
      calculation: { ...view, lotSizeRounded: 0 },
      governance: {
        overallStatus: 'approved',
        checks: [],
        blockedReason: null,
        aiCoaching: null,
      },
    });
    const { service, tradeCreate } = makeService({ calculate });
    await expect(service.logTrade('u1', 'USD', setup)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tradeCreate).not.toHaveBeenCalled();
  });

  // ─── Phase 2 soft-gate (decision #2 — warn, never block) ──────────────────

  it('links the pre-trade checklist to the new trade when a checklistId is supplied', async () => {
    const { service, linkChecklistToTrade, markChecklistSkipped } = makeService(
      {},
    );
    await service.logTrade('u1', 'USD', { ...setup, checklistId: 'chk-1' });

    expect(linkChecklistToTrade).toHaveBeenCalledWith('u1', 't1', 'chk-1');
    expect(markChecklistSkipped).not.toHaveBeenCalled();
  });

  it('marks the checklist skipped when no checklistId is supplied', async () => {
    const { service, linkChecklistToTrade, markChecklistSkipped } = makeService(
      {},
    );
    await service.logTrade('u1', 'USD', setup);

    expect(linkChecklistToTrade).not.toHaveBeenCalled();
    expect(markChecklistSkipped).toHaveBeenCalledWith('u1', 't1');
  });

  it('falls back to marking skipped when the supplied checklist is not linkable', async () => {
    const { service, markChecklistSkipped } = makeService({
      linkChecklistToTrade: jest.fn().mockResolvedValue(false),
    });
    await service.logTrade('u1', 'USD', { ...setup, checklistId: 'chk-x' });

    expect(markChecklistSkipped).toHaveBeenCalledWith('u1', 't1');
  });

  it('never fails the trade log when the soft-gate wiring throws', async () => {
    const { service } = makeService({
      markChecklistSkipped: jest.fn().mockRejectedValue(new Error('boom')),
    });
    // No checklistId → markChecklistSkipped path; its rejection must be swallowed.
    await expect(service.logTrade('u1', 'USD', setup)).resolves.toEqual({
      id: 't1',
    });
  });
});

describe('TradeLogService.closeTrade', () => {
  const openTrade = {
    id: 't1',
    userId: 'u1',
    symbol: 'EURUSD',
    execution: 'buy',
    entry: 1.1,
    lot: 0.2,
    accountCurrency: 'USD',
    stopLoss: { value: 1.095 },
    status: 'open',
  };

  it('computes PnL + R-multiple and settles balance + drawdown', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const { service, txUpdateMany, settleRealizedPnL } = makeService({
      findUnique,
    });

    await service.closeTrade('u1', 't1', 1.105); // +0.005 move → +100 PnL, 1R

    const data = (
      txUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    ).data;
    expect(data.pnl).toBeCloseTo(100, 6);
    expect(data.rMultiple).toBeCloseTo(1, 6);
    expect(data.status).toBe('closed_in_profit');
    expect(settleRealizedPnL).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      expect.closeTo(100, 6),
    );
  });

  it('marks a losing close closed_in_loss', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const { service, txUpdateMany } = makeService({ findUnique });
    await service.closeTrade('u1', 't1', 1.095); // stopped out → -100
    expect(dataOf(txUpdateMany).status).toBe('closed_in_loss');
  });

  it('rejects when the atomic claim loses and does not settle', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service, settleRealizedPnL } = makeService({
      findUnique,
      txUpdateMany,
    });
    await expect(service.closeTrade('u1', 't1', 1.105)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(settleRealizedPnL).not.toHaveBeenCalled();
  });

  it('settles only once across two attempted closes', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const txUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { service, settleRealizedPnL } = makeService({
      findUnique,
      txUpdateMany,
    });
    await service.closeTrade('u1', 't1', 1.105);
    await expect(service.closeTrade('u1', 't1', 1.105)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(settleRealizedPnL).toHaveBeenCalledTimes(1);
  });

  it('404s when the trade belongs to another user', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...openTrade, userId: 'someone-else' });
    const { service } = makeService({ findUnique });
    await expect(service.closeTrade('u1', 't1', 1.1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects closing a non-open trade', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...openTrade, status: 'closed_in_profit' });
    const { service } = makeService({ findUnique });
    await expect(service.closeTrade('u1', 't1', 1.1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('triggers post-trade grading after the close commits', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const { service, gradeClosedTrade } = makeService({ findUnique });
    await service.closeTrade('u1', 't1', 1.105, 'fr');
    expect(gradeClosedTrade).toHaveBeenCalledWith('u1', 't1', 'fr');
  });

  it('still returns the closed trade even if post-trade grading throws', async () => {
    const findUnique = jest.fn().mockResolvedValue(openTrade);
    const gradeClosedTrade = jest
      .fn()
      .mockRejectedValue(new Error('grading boom'));
    const { service } = makeService({ findUnique, gradeClosedTrade });
    await expect(service.closeTrade('u1', 't1', 1.105)).resolves.toEqual(
      expect.objectContaining({ id: 't1', status: 'closed_in_profit' }),
    );
  });
});

describe('TradeLogService.settleManualClose', () => {
  const openTrade = {
    id: 't1',
    userId: 'u1',
    symbol: 'EURUSD',
    execution: 'buy',
    entry: 1.1,
    lot: 0.2,
    accountCurrency: 'USD',
    stopLoss: { value: 1.095 },
    takeProfit: { value: 1.11 },
    status: 'open',
  } as any;

  it('settles exactly once after a successful atomic claim', async () => {
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, settleRealizedPnL } = makeService({ txUpdateMany });
    await service.settleManualClose(
      'u1',
      openTrade,
      { status: 'closed_in_profit' } as any,
      1.105,
    );
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', userId: 'u1', status: 'open' },
      }),
    );
    expect(settleRealizedPnL).toHaveBeenCalledTimes(1);
  });

  it('rejects when the atomic claim loses and does not settle', async () => {
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const { service, settleRealizedPnL } = makeService({ txUpdateMany });
    await expect(
      service.settleManualClose(
        'u1',
        openTrade,
        { status: 'closed_in_profit' } as any,
        1.105,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settleRealizedPnL).not.toHaveBeenCalled();
  });

  it('settles only once across two attempted manual status closes', async () => {
    const txUpdateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const { service, settleRealizedPnL } = makeService({ txUpdateMany });
    const data = { status: 'closed_in_profit' } as any;

    await service.settleManualClose('u1', openTrade, data, 1.105);
    await expect(
      service.settleManualClose('u1', openTrade, data, 1.105),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settleRealizedPnL).toHaveBeenCalledTimes(1);
  });
});

describe('TradeLogService.applyStopAdjustment', () => {
  const openTrade = {
    id: 't1',
    userId: 'u1',
    execution: 'buy',
    stopLoss: { value: 1.095, pips: 50 },
    stopAdjustments: [],
    status: 'open',
  };

  it('appends { ts, oldStop, newStop, reason } and moves the active stop', async () => {
    const findFirst = jest.fn().mockResolvedValue(openTrade);
    const { service, tradeUpdate } = makeService({ findFirst });

    await service.applyStopAdjustment('u1', 't1', 1.092, 'widening to news');

    const data = dataOf(tradeUpdate);
    expect((data.stopLoss as { value: number }).value).toBe(1.092);
    const adjustments = data.stopAdjustments as Array<Record<string, unknown>>;
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].oldStop).toBe(1.095);
    expect(adjustments[0].newStop).toBe(1.092);
    expect(adjustments[0].reason).toBe('widening to news');
    expect(typeof adjustments[0].ts).toBe('string');
  });

  it('appends to an existing adjustments array', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      ...openTrade,
      stopLoss: { value: 1.093 },
      stopAdjustments: [
        { ts: 'x', oldStop: 1.095, newStop: 1.093, reason: 'first' },
      ],
    });
    const { service, tradeUpdate } = makeService({ findFirst });

    await service.applyStopAdjustment('u1', 't1', 1.091, 'second');

    const adjustments = dataOf(tradeUpdate).stopAdjustments as unknown[];
    expect(adjustments).toHaveLength(2);
  });

  it('404s when the trade is not found / not owned', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service } = makeService({ findFirst });
    await expect(
      service.applyStopAdjustment('u1', 't1', 1.092, 'reason'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects adjusting a non-open trade', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...openTrade, status: 'closed_in_profit' });
    const { service } = makeService({ findFirst });
    await expect(
      service.applyStopAdjustment('u1', 't1', 1.092, 'reason'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TradeLogService.deleteTrade', () => {
  const baseTrade = {
    id: 't1',
    userId: 'u1',
    symbol: 'EURUSD',
    pnl: null as number | null,
    status: 'open',
  };

  it('deletes an open trade without touching balance/drawdown', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...baseTrade, status: 'open', pnl: null });
    const { service, txDelete, applyBalanceDelta, profileUpdate } = makeService(
      {
        findFirst,
      },
    );

    const result = await service.deleteTrade('u1', 't1');

    expect(result).toEqual({ deleted: true });
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(applyBalanceDelta).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('deletes a neutral-closed trade without reversing PnL', async () => {
    // The legacy neutral 'closed' status never settled PnL, so even a stray pnl
    // value must not be reversed.
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...baseTrade, status: 'closed', pnl: 50 });
    const { service, txDelete, applyBalanceDelta, profileUpdate } = makeService(
      {
        findFirst,
      },
    );

    await service.deleteTrade('u1', 't1');

    expect(txDelete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(applyBalanceDelta).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('reverses a settled profit (closed_in_profit): decrements balance + recomputes drawdown', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      ...baseTrade,
      status: 'closed_in_profit',
      pnl: 100,
    });
    const { service, txDelete, applyBalanceDelta, profileUpdate } = makeService(
      {
        findFirst,
      },
    );

    await service.deleteTrade('u1', 't1');

    expect(txDelete).toHaveBeenCalledWith({ where: { id: 't1' } });
    // Reversal is the inverse of settleRealizedPnL: -pnl.
    expect(applyBalanceDelta).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      -100,
    );
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        data: expect.objectContaining({
          accountBalance: { decrement: 100 },
        }),
      }),
    );
  });

  it('reverses a settled loss (closed_in_loss): adds the loss back to balance', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...baseTrade, status: 'closed_in_loss', pnl: -100 });
    const { service, applyBalanceDelta, profileUpdate } = makeService({
      findFirst,
    });

    await service.deleteTrade('u1', 't1');

    // -(-100) = +100 restored.
    expect(applyBalanceDelta).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      100,
    );
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountBalance: { decrement: -100 },
        }),
      }),
    );
  });

  it('reverses an auto-closed trade (reached_tp settles PnL too)', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...baseTrade, status: 'reached_tp', pnl: 75 });
    const { service, applyBalanceDelta } = makeService({ findFirst });

    await service.deleteTrade('u1', 't1');

    expect(applyBalanceDelta).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      -75,
    );
  });

  it('treats a settled-status trade with null/0 pnl as a safe no-op', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      ...baseTrade,
      status: 'closed_in_profit',
      pnl: null,
    });
    const { service, txDelete, applyBalanceDelta, profileUpdate } = makeService(
      {
        findFirst,
      },
    );

    await service.deleteTrade('u1', 't1');

    expect(txDelete).toHaveBeenCalled();
    expect(applyBalanceDelta).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('404s when the trade does not belong to the user', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const { service, txDelete } = makeService({ findFirst });

    await expect(service.deleteTrade('u1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(txDelete).not.toHaveBeenCalled();
  });

  it('deletes a settled trade with no risk profile without crashing (settlement was a no-op)', async () => {
    // An auto-closed trade (reached_tp) can carry a stored pnl while the user has
    // no risk profile, because settleRealizedPnL no-ops without a profile. Delete
    // must mirror that gate — skip the reversal rather than throwing P2025 on a
    // missing riskProfile row.
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...baseTrade, status: 'reached_tp', pnl: 75 });
    const profileFindUnique = jest.fn().mockResolvedValue(null);
    const { service, txDelete, applyBalanceDelta, profileUpdate } = makeService(
      {
        findFirst,
        profileFindUnique,
      },
    );

    const result = await service.deleteTrade('u1', 't1');

    expect(result).toEqual({ deleted: true });
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(applyBalanceDelta).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('rounds a fractional settled pnl to 2dp so the reversal is the exact inverse', async () => {
    // Settlement applied roundCurrency(pnl); the stored trade.pnl is raw. Reversal
    // must decrement the same rounded value, not the raw 5-dp number.
    const findFirst = jest.fn().mockResolvedValue({
      ...baseTrade,
      status: 'closed_in_profit',
      pnl: 100.12345,
    });
    const { service, applyBalanceDelta, profileUpdate } = makeService({
      findFirst,
    });

    await service.deleteTrade('u1', 't1');

    expect(applyBalanceDelta).toHaveBeenCalledWith(
      expect.anything(),
      'u1',
      -100.12,
    );
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountBalance: { decrement: 100.12 },
        }),
      }),
    );
  });
});
