import { DrawdownService } from './drawdown.service';
import { PrismaService } from '../prisma/prisma.service';

type UpdateData = Record<string, unknown>;
const dataOf = (mock: jest.Mock, call = 0): UpdateData => {
  const calls = mock.mock.calls as unknown as Array<[{ data: UpdateData }]>;
  return calls[call][0].data;
};

describe('DrawdownService.getState', () => {
  it('lazily creates a row seeded from the risk profile balance', async () => {
    const create = jest.fn().mockResolvedValue({
      userId: 'u1',
      accountBalance: 10000,
      peakBalance: 10000,
      dailyOpenBalance: 10000,
      weeklyOpenBalance: 10000,
      monthlyOpenBalance: 10000,
      dailyBreached: false,
      weeklyBreached: false,
      monthlyBreached: false,
    });
    const prisma = {
      drawdownState: { findUnique: jest.fn().mockResolvedValue(null), create },
      riskProfile: {
        findUnique: jest.fn().mockResolvedValue({ accountBalance: 10000 }),
      },
    } as unknown as PrismaService;

    const state = await new DrawdownService(prisma).getState('u1');

    expect(create).toHaveBeenCalled();
    expect(state.accountBalance).toBe(10000);
    expect(state.drawdownPct).toEqual({
      daily: 0,
      weekly: 0,
      monthly: 0,
      allTime: 0,
    });
  });

  it('recomputes drawdown percentages from the stored balances', async () => {
    const prisma = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 9500,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        create: jest.fn(),
      },
      riskProfile: { findUnique: jest.fn() },
    } as unknown as PrismaService;

    const state = await new DrawdownService(prisma).getState('u1');
    expect(state.drawdownPct.daily).toBeCloseTo(5, 6);
    expect(state.drawdownPct.allTime).toBeCloseTo(5, 6);
  });
});

describe('DrawdownService.applyBalanceDelta', () => {
  it('updates balance, recomputes drawdown, and trips a breached circuit breaker', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 10000,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 10000,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        create: jest.fn(),
        update,
      },
      riskProfile: {
        findUnique: jest.fn().mockResolvedValue({
          maxDailyDrawdownPct: 5,
          maxWeeklyDrawdownPct: 8,
          maxMonthlyDrawdownPct: 10,
        }),
      },
    };
    const prisma = {} as unknown as PrismaService;

    // -600 on 10000 → 9400 → daily drawdown 6% ≥ 5% → breached.
    await new DrawdownService(prisma).applyBalanceDelta(
      tx as never,
      'u1',
      -600,
    );

    const data = dataOf(update);
    expect(data.accountBalance).toBe(9400);
    expect(data.dailyBreached).toBe(true);
    expect(data.weeklyBreached).toBe(false);
  });
});

describe('DrawdownService.settleRealizedPnL', () => {
  it('is a no-op when the user has no risk profile', async () => {
    const drawdownUpdate = jest.fn();
    const profileUpdate = jest.fn();
    const tx = {
      riskProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: profileUpdate,
      },
      drawdownState: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: drawdownUpdate,
      },
    };

    await new DrawdownService({} as unknown as PrismaService).settleRealizedPnL(
      tx as never,
      'u1',
      100,
    );

    expect(drawdownUpdate).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it('increments balance and recomputes drawdown when a profile exists', async () => {
    const drawdownUpdate = jest.fn().mockResolvedValue({});
    const profileUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      riskProfile: {
        findUnique: jest.fn().mockResolvedValue({
          maxDailyDrawdownPct: 5,
          maxWeeklyDrawdownPct: 8,
          maxMonthlyDrawdownPct: 10,
        }),
        update: profileUpdate,
      },
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 10000,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 10000,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        create: jest.fn(),
        update: drawdownUpdate,
      },
    };

    await new DrawdownService({} as unknown as PrismaService).settleRealizedPnL(
      tx as never,
      'u1',
      250,
    );

    expect(dataOf(drawdownUpdate).accountBalance).toBe(10250);
    const profileData = dataOf(profileUpdate);
    expect(profileData.accountBalance).toEqual({ increment: 250 });
    expect(profileData.lastBalanceSource).toBe('trade_close');
  });
});

describe('DrawdownService.reconcileBreachFlags', () => {
  // Balance recovered to 9500 (5% below the 10000 period opens) with the sticky
  // monthly breach still set from an earlier deeper drawdown.
  const breachedRow = {
    userId: 'u1',
    accountBalance: 9500,
    peakBalance: 10000,
    dailyOpenBalance: 10000,
    weeklyOpenBalance: 10000,
    monthlyOpenBalance: 10000,
    dailyBreached: false,
    weeklyBreached: false,
    monthlyBreached: true,
  };

  it('clears a sticky breach when the new limit is above the current drawdown', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue(breachedRow),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    // Raise the monthly limit to 15%; current monthly drawdown is 5% → clear.
    await new DrawdownService(
      {} as unknown as PrismaService,
    ).reconcileBreachFlags(tx as never, 'u1', { maxMonthlyDrawdownPct: 15 });

    expect(dataOf(update)).toEqual({ monthlyBreached: false });
  });

  it('re-arms a breach when the new limit drops below the current drawdown', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          ...breachedRow,
          monthlyBreached: false,
        }),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    // Tighten the monthly limit to 4%; current monthly drawdown is 5% → breach.
    await new DrawdownService(
      {} as unknown as PrismaService,
    ).reconcileBreachFlags(tx as never, 'u1', { maxMonthlyDrawdownPct: 4 });

    expect(dataOf(update)).toEqual({ monthlyBreached: true });
  });

  it('only touches the periods whose limit changed', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue(breachedRow),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    await new DrawdownService(
      {} as unknown as PrismaService,
    ).reconcileBreachFlags(tx as never, 'u1', { maxMonthlyDrawdownPct: 15 });

    const data = dataOf(update);
    expect(data).not.toHaveProperty('dailyBreached');
    expect(data).not.toHaveProperty('weeklyBreached');
  });

  it('is a no-op when no drawdown limits are provided', async () => {
    const findUnique = jest.fn();
    const update = jest.fn();
    const tx = {
      drawdownState: { findUnique, create: jest.fn(), update },
      riskProfile: { findUnique: jest.fn() },
    };

    await new DrawdownService(
      {} as unknown as PrismaService,
    ).reconcileBreachFlags(tx as never, 'u1', {});

    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('is a no-op when no drawdown row exists yet', async () => {
    const update = jest.fn();
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    await new DrawdownService(
      {} as unknown as PrismaService,
    ).reconcileBreachFlags(tx as never, 'u1', { maxMonthlyDrawdownPct: 15 });

    expect(update).not.toHaveBeenCalled();
  });
});

describe('DrawdownService.setManualBalance', () => {
  it('sets the balance directly and recomputes drawdown against open/peak', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 8000, // stale running balance
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: true,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    // Manual reconciliation: real balance is 9500 (not an increment of 8000).
    await new DrawdownService({} as unknown as PrismaService).setManualBalance(
      tx as never,
      'u1',
      9500,
    );

    const data = dataOf(update);
    expect(data.accountBalance).toBe(9500); // absolute set, not 8000-based
    expect(data.peakBalance).toBe(10000); // peak unchanged (9500 < 10000)
    expect(data.dailyDrawdownPct).toBeCloseTo(5, 6); // (10000-9500)/10000
    expect(data.allTimeDrawdownPct).toBeCloseTo(5, 6);
    // Sticky breach flags are NOT touched by a manual reconciliation.
    expect(data).not.toHaveProperty('dailyBreached');
  });

  it('ratchets the peak up when the manual balance exceeds it', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'u1',
          accountBalance: 10000,
          peakBalance: 10000,
          dailyOpenBalance: 10000,
          weeklyOpenBalance: 10000,
          monthlyOpenBalance: 10000,
          dailyBreached: false,
          weeklyBreached: false,
          monthlyBreached: false,
        }),
        create: jest.fn(),
        update,
      },
      riskProfile: { findUnique: jest.fn() },
    };

    await new DrawdownService({} as unknown as PrismaService).setManualBalance(
      tx as never,
      'u1',
      12000,
    );

    const data = dataOf(update);
    expect(data.accountBalance).toBe(12000);
    expect(data.peakBalance).toBe(12000);
    expect(data.allTimeDrawdownPct).toBeCloseTo(0, 6);
  });

  it('lazily creates the row (seeded from profile) when none exists', async () => {
    const create = jest.fn().mockResolvedValue({});
    const update = jest.fn();
    const tx = {
      drawdownState: {
        findUnique: jest.fn().mockResolvedValue(null),
        create,
        update,
      },
      // Profile balance was already updated to 9500 in the same transaction.
      riskProfile: {
        findUnique: jest.fn().mockResolvedValue({ accountBalance: 9500 }),
      },
    };

    await new DrawdownService({} as unknown as PrismaService).setManualBalance(
      tx as never,
      'u1',
      9500,
    );

    // Seeds every balance field to the reconciled value; no stale-row update.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountBalance: 9500,
          peakBalance: 9500,
          dailyOpenBalance: 9500,
        }),
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('DrawdownService.resetCircuitBreakers', () => {
  type Row = {
    userId: string;
    accountBalance: number;
    lastResetLocalDate?: string | null;
    user?: { timezone: string | null } | null;
  };

  function makeService(update: jest.Mock, rows: Row[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    // Build a transaction-client proxy: SELECT FOR UPDATE is a no-op in tests,
    // findUniqueOrThrow re-reads the same row that findMany returned, and update
    // forwards to the same mock so test assertions on update still work.
    const makeTxDb = (row: Row) => ({
      $queryRaw: jest.fn().mockResolvedValue([]),
      drawdownState: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        update,
      },
    });
    const $transaction = jest.fn().mockImplementation(async (cb: (db: unknown) => Promise<unknown>) => {
      // Execute callback for each row that would reach the transaction.
      // In practice each $transaction call covers one row, so pass the first
      // row that matches the userId the callback locks on.
      const row = rows[0];
      return cb(makeTxDb(row));
    });
    const prisma = {
      drawdownState: { findMany, update },
      $transaction,
    } as unknown as PrismaService;
    return { service: new DrawdownService(prisma), findMany };
  }

  function row(overrides: Partial<Row> = {}): Row {
    return {
      userId: 'u1',
      accountBalance: 9400,
      lastResetLocalDate: null,
      user: { timezone: 'UTC' },
      ...overrides,
    };
  }

  it('always resets the daily breaker and opens the day at the current balance', async () => {
    const update = jest.fn().mockResolvedValue({});
    // 2026-01-07 is a Wednesday and not the 1st → daily only.
    await makeService(update, [row()]).service.resetCircuitBreakers(
      new Date('2026-01-07T00:00:00Z'),
    );
    const data = dataOf(update);
    expect(data.dailyBreached).toBe(false);
    expect(data.dailyOpenBalance).toBe(9400);
    expect(data.lastResetLocalDate).toBe('2026-01-07');
    expect(data).not.toHaveProperty('weeklyOpenBalance');
    expect(data).not.toHaveProperty('monthlyOpenBalance');
  });

  it('also resets the weekly breaker on Monday', async () => {
    const update = jest.fn().mockResolvedValue({});
    // 2026-01-05 is a Monday (not the 1st).
    await makeService(update, [row()]).service.resetCircuitBreakers(
      new Date('2026-01-05T00:00:00Z'),
    );
    const data = dataOf(update);
    expect(data).toHaveProperty('weeklyOpenBalance', 9400);
    expect(data).not.toHaveProperty('monthlyOpenBalance');
  });

  it('also resets the monthly breaker on the first of the month', async () => {
    const update = jest.fn().mockResolvedValue({});
    await makeService(update, [row()]).service.resetCircuitBreakers(
      new Date('2026-06-01T00:00:00Z'),
    );
    const data = dataOf(update);
    expect(data).toHaveProperty('monthlyOpenBalance', 9400);
  });

  it('rolls a user over at their own local midnight, not UTC midnight', async () => {
    const update = jest.fn().mockResolvedValue({});
    // 2026-01-07 15:30 UTC is 2026-01-08 00:30 in Tokyo (UTC+9) → new local day.
    await makeService(update, [
      row({ user: { timezone: 'Asia/Tokyo' } }),
    ]).service.resetCircuitBreakers(new Date('2026-01-07T15:30:00Z'));
    const data = dataOf(update);
    expect(data.lastResetLocalDate).toBe('2026-01-08');
    expect(data.dailyOpenBalance).toBe(9400);
  });

  it('guards on the local date, not the UTC date', async () => {
    const update = jest.fn().mockResolvedValue({});
    // 2026-01-08 02:00 UTC is still 2026-01-07 21:00 in New York (UTC-5): UTC has
    // rolled to the 8th but the user's local day has not, so already-reset-on-the
    // -7th must still skip.
    await makeService(update, [
      row({
        user: { timezone: 'America/New_York' },
        lastResetLocalDate: '2026-01-07',
      }),
    ]).service.resetCircuitBreakers(new Date('2026-01-08T02:00:00Z'));
    expect(update).not.toHaveBeenCalled();
  });

  it('skips a user already reset on the same local day (idempotent across runs)', async () => {
    const update = jest.fn().mockResolvedValue({});
    await makeService(update, [
      row({ lastResetLocalDate: '2026-01-07' }),
    ]).service.resetCircuitBreakers(new Date('2026-01-07T00:00:00Z'));
    expect(update).not.toHaveBeenCalled();
  });

  it('resets weekly/monthly on the user-local boundary, not the UTC one', async () => {
    const update = jest.fn().mockResolvedValue({});
    // 2026-05-31 23:30 UTC is 2026-06-01 00:30 in Paris (UTC+2, DST) — a Monday.
    await makeService(update, [
      row({ user: { timezone: 'Europe/Paris' } }),
    ]).service.resetCircuitBreakers(new Date('2026-05-31T23:30:00Z'));
    const data = dataOf(update);
    expect(data.lastResetLocalDate).toBe('2026-06-01');
    expect(data).toHaveProperty('monthlyOpenBalance', 9400);
    expect(data).toHaveProperty('weeklyOpenBalance', 9400);
  });

  it('falls back to UTC for a missing or invalid timezone', async () => {
    const update = jest.fn().mockResolvedValue({});
    await makeService(update, [
      row({ user: { timezone: 'Not/AZone' } }),
    ]).service.resetCircuitBreakers(new Date('2026-01-07T00:00:00Z'));
    const data = dataOf(update);
    expect(data.lastResetLocalDate).toBe('2026-01-07');
  });
});
