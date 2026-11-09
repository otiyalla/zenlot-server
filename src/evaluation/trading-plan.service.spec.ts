import { TradingPlanService } from './trading-plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertTradingPlanDto } from './dto/upsert-trading-plan.dto';

const USER_ID = 'u1';

const dto: UpsertTradingPlanDto = {
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

const storedRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'plan-2',
  userId: USER_ID,
  version: 2,
  isCurrent: true,
  entryConditions: dto.entryConditions,
  stopRules: dto.stopRules,
  exitRules: dto.exitRules,
  sessionRules: dto.sessionRules,
  createdAt: new Date('2026-06-26T00:00:00Z'),
  ...over,
});

describe('TradingPlanService', () => {
  let findFirst: jest.Mock;
  let txFindFirst: jest.Mock;
  let txUpdate: jest.Mock;
  let txCreate: jest.Mock;
  let service: TradingPlanService;

  beforeEach(() => {
    findFirst = jest.fn();
    txFindFirst = jest.fn();
    txUpdate = jest.fn().mockResolvedValue({});
    txCreate = jest.fn().mockResolvedValue(storedRow());

    const tx = {
      tradingPlan: {
        findFirst: txFindFirst,
        update: txUpdate,
        create: txCreate,
      },
    };
    const prisma = {
      tradingPlan: { findFirst },
      $transaction: jest
        .fn()
        .mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
    } as unknown as PrismaService;

    service = new TradingPlanService(prisma);
  });

  it('returns null when the user has no current plan', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.getCurrentPlan(USER_ID)).resolves.toBeNull();
  });

  it('maps a stored current plan to the engine domain shape', async () => {
    findFirst.mockResolvedValue(storedRow());
    const plan = await service.getCurrentPlan(USER_ID);
    expect(plan).toMatchObject({
      userId: USER_ID,
      version: 2,
      entryConditions: dto.entryConditions,
      stopRules: dto.stopRules,
    });
    expect(plan?.updatedAt).toBe('2026-06-26T00:00:00.000Z');
  });

  it('creates version 1 when there is no previous plan', async () => {
    txFindFirst.mockResolvedValue(null);
    txCreate.mockResolvedValue(storedRow({ version: 1, id: 'plan-1' }));

    const plan = await service.savePlan(USER_ID, dto);

    expect(txUpdate).not.toHaveBeenCalled();
    expect(
      (txCreate.mock.calls[0][0] as { data: { version: number } }).data.version,
    ).toBe(1);
    expect(plan.version).toBe(1);
  });

  it('marks the previous plan not-current and bumps the version', async () => {
    txFindFirst.mockResolvedValue({ id: 'plan-1', version: 1 });
    txCreate.mockResolvedValue(storedRow({ version: 2 }));

    await service.savePlan(USER_ID, dto);

    // The previous current plan is flipped FIRST (partial-unique index).
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { isCurrent: false },
    });
    const createArg = txCreate.mock.calls[0][0] as {
      data: { version: number; isCurrent: boolean };
    };
    expect(createArg.data.version).toBe(2);
    expect(createArg.data.isCurrent).toBe(true);
  });
});
