import { Test, TestingModule } from '@nestjs/testing';
import { RiskProfileService } from './risk-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DrawdownService } from './drawdown.service';

const USER_ID = 'user-1';
const CURRENCY = 'USD';

// A representative stored row (Prisma defaults applied).
const storedRow = {
  userId: USER_ID,
  maxRiskPerTradePct: 1,
  maxPortfolioExposurePct: 3,
  maxDailyDrawdownPct: 5,
  maxWeeklyDrawdownPct: 8,
  maxMonthlyDrawdownPct: 10,
  maxOpenTrades: 5,
  maxCorrelatedExposure: 6,
  accountBalance: 0,
  lastBalanceSetAt: new Date('2026-01-01T00:00:00Z'),
  lastBalanceSource: 'manual',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

interface UpsertArg {
  where: { userId: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}

describe('RiskProfileService', () => {
  let service: RiskProfileService;
  let upsert: jest.Mock;
  let auditLog: jest.Mock;
  let setManualBalance: jest.Mock;
  let reconcileBreachFlags: jest.Mock;
  let transaction: jest.Mock;

  const firstUpsertArg = (): UpsertArg => {
    const calls = upsert.mock.calls as unknown as [UpsertArg][];
    return calls[0][0];
  };

  beforeEach(async () => {
    upsert = jest.fn().mockResolvedValue(storedRow);
    auditLog = jest.fn().mockResolvedValue(undefined);
    setManualBalance = jest.fn().mockResolvedValue(undefined);
    reconcileBreachFlags = jest.fn().mockResolvedValue(undefined);

    // The tx client the service operates on; getProfile uses the bare prisma
    // client, updateProfile runs inside $transaction with this same shape.
    const tx = { riskProfile: { upsert } };
    transaction = jest.fn((cb: (client: typeof tx) => unknown) => cb(tx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskProfileService,
        {
          provide: PrismaService,
          useValue: { riskProfile: { upsert }, $transaction: transaction },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: DrawdownService,
          useValue: { setManualBalance, reconcileBreachFlags },
        },
      ],
    }).compile();

    service = module.get<RiskProfileService>(RiskProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('lazily creates a default profile and echoes the account currency', async () => {
      const result = await service.getProfile(USER_ID, CURRENCY);

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        update: {},
        create: { userId: USER_ID },
      });
      // Spec conservative defaults surface through.
      expect(result).toMatchObject({
        userId: USER_ID,
        accountCurrency: CURRENCY,
        maxRiskPerTradePct: 1,
        maxPortfolioExposurePct: 3,
        maxOpenTrades: 5,
      });
    });
  });

  describe('updateProfile', () => {
    it('maps only provided governance fields into the update', async () => {
      await service.updateProfile(
        USER_ID,
        { maxRiskPerTradePct: 2, maxOpenTrades: 8 },
        CURRENCY,
      );

      const arg = firstUpsertArg();
      expect(arg.where).toEqual({ userId: USER_ID });
      expect(arg.update).toEqual({ maxRiskPerTradePct: 2, maxOpenTrades: 8 });
      // No balance touched → no reconciliation stamp.
      expect(arg.update).not.toHaveProperty('lastBalanceSource');
      expect(arg.update).not.toHaveProperty('lastBalanceSetAt');
      // …and the drawdown row is left untouched.
      expect(setManualBalance).not.toHaveBeenCalled();
      expect(reconcileBreachFlags).not.toHaveBeenCalled();
    });

    it('re-evaluates sticky breach flags when a drawdown limit changes', async () => {
      await service.updateProfile(
        USER_ID,
        { maxMonthlyDrawdownPct: 15 },
        CURRENCY,
      );

      // The profile write and breach reconciliation share one $transaction, and
      // only the changed limit is forwarded (SCRUM-53).
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(reconcileBreachFlags).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        {
          maxDailyDrawdownPct: undefined,
          maxWeeklyDrawdownPct: undefined,
          maxMonthlyDrawdownPct: 15,
        },
      );
      const txClient = reconcileBreachFlags.mock.calls[0][0] as {
        riskProfile: { upsert: jest.Mock };
      };
      expect(txClient.riskProfile.upsert).toBe(upsert);
    });

    it('stamps a manual reconciliation when accountBalance is set', async () => {
      await service.updateProfile(USER_ID, { accountBalance: 10000 }, CURRENCY);

      const arg = firstUpsertArg();
      expect(arg.update.accountBalance).toBe(10000);
      expect(arg.update.lastBalanceSource).toBe('manual');
      expect(arg.update.lastBalanceSetAt).toBeInstanceOf(Date);
    });

    it('syncs the new balance into the drawdown row, in the same transaction', async () => {
      await service.updateProfile(USER_ID, { accountBalance: 10000 }, CURRENCY);

      // Profile write and drawdown reconciliation share one $transaction so the
      // Drawdown screen never reads a stale balance.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(setManualBalance).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        10000,
      );
      // The upsert ran on the tx client passed to setManualBalance.
      const txClient = setManualBalance.mock.calls[0][0] as {
        riskProfile: { upsert: jest.Mock };
      };
      expect(txClient.riskProfile.upsert).toBe(upsert);
    });

    it('reconciles a changed limit against the newly set balance', async () => {
      let drawdownRow = {
        userId: USER_ID,
        accountBalance: 9000,
        peakBalance: 10000,
        dailyOpenBalance: 10000,
        weeklyOpenBalance: 10000,
        monthlyOpenBalance: 10000,
        dailyBreached: false,
        weeklyBreached: false,
        monthlyBreached: true,
      };
      const drawdownState = {
        findUnique: jest.fn(() => Promise.resolve({ ...drawdownRow })),
        create: jest.fn(),
        update: jest.fn(({ data }: { data: Partial<typeof drawdownRow> }) => {
          drawdownRow = { ...drawdownRow, ...data };
          return Promise.resolve(drawdownRow);
        }),
      };
      const riskProfile = {
        upsert: jest.fn(({ update }: { update: Record<string, unknown> }) =>
          Promise.resolve({ ...storedRow, ...update }),
        ),
        findUnique: jest.fn(),
      };
      const tx = { riskProfile, drawdownState };
      const prisma = {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      };
      const actualService = new RiskProfileService(
        prisma as unknown as PrismaService,
        {
          log: jest.fn().mockResolvedValue(undefined),
        } as unknown as AuditService,
        new DrawdownService({} as PrismaService),
      );

      await actualService.updateProfile(
        USER_ID,
        { accountBalance: 9800, maxMonthlyDrawdownPct: 5 },
        CURRENCY,
      );

      // The top-up reduces the current drawdown from 10% to 2%, so the raised
      // 5% limit must clear the sticky flag using the row written just before.
      expect(drawdownRow.accountBalance).toBe(9800);
      expect(drawdownRow.monthlyBreached).toBe(false);
      expect(drawdownState.findUnique).toHaveBeenCalledTimes(2);
    });

    it('writes an audit log entry', async () => {
      await service.updateProfile(
        USER_ID,
        { maxRiskPerTradePct: 2 },
        CURRENCY,
        '1.2.3.4',
        'jest',
      );

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          action: 'RISK_PROFILE_UPDATED',
          resource: 'riskProfile',
          resourceId: USER_ID,
        }),
      );
    });

    it('does not throw if audit logging fails', async () => {
      auditLog.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.updateProfile(USER_ID, { maxRiskPerTradePct: 2 }, CURRENCY),
      ).resolves.toMatchObject({ accountCurrency: CURRENCY });
    });
  });
});
