import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, drawdownState } from '../../prisma/generated/prisma/client';
import { calculateDrawdown, DrawdownState } from './engine';

/** Prisma client or an interactive-transaction client. */
type Db = PrismaService | Prisma.TransactionClient;

const toNumber = (value: number | { toString(): string }): number =>
  typeof value === 'number' ? value : Number(value.toString());

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class DrawdownService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the engine-shaped drawdown state for governance/reads, lazily
   * creating the row (seeded from the risk profile's balance) on first access.
   * Drawdown percentages are recomputed from balances; breach flags are the
   * stored sticky values (set on close, cleared by the daily/period reset).
   */
  async getState(userId: string): Promise<DrawdownState> {
    const row = await this.getOrCreateRow(userId);
    const accountBalance = toNumber(row.accountBalance);
    const peakBalance = toNumber(row.peakBalance);
    const dailyOpenBalance = toNumber(row.dailyOpenBalance);
    const weeklyOpenBalance = toNumber(row.weeklyOpenBalance);
    const monthlyOpenBalance = toNumber(row.monthlyOpenBalance);
    const drawdownPct = calculateDrawdown(
      accountBalance,
      dailyOpenBalance,
      weeklyOpenBalance,
      monthlyOpenBalance,
      peakBalance,
    );
    return {
      accountBalance,
      peakBalance,
      dailyOpenBalance,
      weeklyOpenBalance,
      monthlyOpenBalance,
      drawdownPct,
      circuitBreakers: {
        dailyBreached: row.dailyBreached,
        weeklyBreached: row.weeklyBreached,
        monthlyBreached: row.monthlyBreached,
      },
    };
  }

  private async getOrCreateRow(
    userId: string,
    db: Db = this.prisma,
  ): Promise<drawdownState> {
    const existing = await db.drawdownState.findUnique({ where: { userId } });
    if (existing) return existing;
    const profile = await db.riskProfile.findUnique({ where: { userId } });
    const balance = toNumber(profile?.accountBalance ?? 0);
    return db.drawdownState.create({
      data: {
        userId,
        accountBalance: balance,
        peakBalance: balance,
        dailyOpenBalance: balance,
        weeklyOpenBalance: balance,
        monthlyOpenBalance: balance,
      },
    });
  }

  /**
   * Applies a realized PnL delta to the running balance and recomputes drawdown,
   * updating sticky circuit-breaker flags. Runs inside the caller's transaction
   * so the trade close, balance, and drawdown move atomically.
   */
  async applyBalanceDelta(
    db: Db,
    userId: string,
    delta: number,
  ): Promise<void> {
    const row = await this.getOrCreateRow(userId, db);
    const profile = await db.riskProfile.findUnique({ where: { userId } });

    const accountBalance = toNumber(row.accountBalance);
    const peakBalanceBefore = toNumber(row.peakBalance);
    const dailyOpenBalance = toNumber(row.dailyOpenBalance);
    const weeklyOpenBalance = toNumber(row.weeklyOpenBalance);
    const monthlyOpenBalance = toNumber(row.monthlyOpenBalance);

    const newBalance = roundCurrency(accountBalance + delta);
    const peakBalance = Math.max(peakBalanceBefore, newBalance);
    const dd = calculateDrawdown(
      newBalance,
      dailyOpenBalance,
      weeklyOpenBalance,
      monthlyOpenBalance,
      peakBalance,
    );

    await db.drawdownState.update({
      where: { userId },
      data: {
        accountBalance: newBalance,
        peakBalance,
        dailyDrawdownPct: dd.daily,
        weeklyDrawdownPct: dd.weekly,
        monthlyDrawdownPct: dd.monthly,
        allTimeDrawdownPct: dd.allTime,
        // Breaches are sticky for the period — once true, stay true until reset.
        dailyBreached:
          row.dailyBreached ||
          dd.daily >= (profile?.maxDailyDrawdownPct ?? Infinity),
        weeklyBreached:
          row.weeklyBreached ||
          dd.weekly >= (profile?.maxWeeklyDrawdownPct ?? Infinity),
        monthlyBreached:
          row.monthlyBreached ||
          dd.monthly >= (profile?.maxMonthlyDrawdownPct ?? Infinity),
      },
    });
  }

  /**
   * Settles a realized trade PnL onto the account: increments the running
   * balance and recomputes drawdown. No-op when the user has no risk profile
   * (balance tracking applies only once they've set up a starting balance).
   * Used by both the manual close and the auto-close paths; pass a transaction
   * client so the trade close and settlement move atomically.
   */
  async settleRealizedPnL(db: Db, userId: string, pnl: number): Promise<void> {
    const profile = await db.riskProfile.findUnique({ where: { userId } });
    if (!profile) return;

    const roundedPnl = roundCurrency(pnl);

    await this.applyBalanceDelta(db, userId, roundedPnl);
    await db.riskProfile.update({
      where: { userId },
      data: {
        accountBalance: { increment: roundedPnl },
        lastBalanceSource: 'trade_close',
        lastBalanceSetAt: new Date(),
      },
    });
  }

  /**
   * Re-evaluates the sticky circuit-breaker flags against changed drawdown
   * limits (spec Section 14). Called when the user edits their risk profile:
   * a breach flag is set at close time relative to the *then-current* limit and
   * stays sticky until the period reset, so raising a limit would otherwise leave
   * a trade blocked by a breach that no longer applies (SCRUM-53). For each limit
   * supplied, the flag is recomputed as "current period drawdown ≥ new limit" —
   * the same comparison governance uses — so the block always reflects the user's
   * current limits: raising a limit clears a stale breach, lowering one below the
   * current drawdown re-arms it. Only the periods whose limit actually changed are
   * touched; a missing drawdown row means no breach has been recorded yet, so
   * there is nothing to reconcile. Runs inside the caller's transaction so the
   * profile and breach flags move atomically.
   */
  async reconcileBreachFlags(
    db: Db,
    userId: string,
    limits: {
      maxDailyDrawdownPct?: number;
      maxWeeklyDrawdownPct?: number;
      maxMonthlyDrawdownPct?: number;
    },
  ): Promise<void> {
    const { maxDailyDrawdownPct, maxWeeklyDrawdownPct, maxMonthlyDrawdownPct } =
      limits;
    if (
      maxDailyDrawdownPct === undefined &&
      maxWeeklyDrawdownPct === undefined &&
      maxMonthlyDrawdownPct === undefined
    ) {
      return;
    }

    const existing = await db.drawdownState.findUnique({ where: { userId } });
    if (!existing) return;

    const dd = calculateDrawdown(
      toNumber(existing.accountBalance),
      toNumber(existing.dailyOpenBalance),
      toNumber(existing.weeklyOpenBalance),
      toNumber(existing.monthlyOpenBalance),
      toNumber(existing.peakBalance),
    );

    const data: Prisma.drawdownStateUpdateInput = {};
    if (maxDailyDrawdownPct !== undefined)
      data.dailyBreached = dd.daily >= maxDailyDrawdownPct;
    if (maxWeeklyDrawdownPct !== undefined)
      data.weeklyBreached = dd.weekly >= maxWeeklyDrawdownPct;
    if (maxMonthlyDrawdownPct !== undefined)
      data.monthlyBreached = dd.monthly >= maxMonthlyDrawdownPct;

    await db.drawdownState.update({ where: { userId }, data });
  }

  /**
   * Reconciles the drawdown row to a manually-set account balance (spec §11.2).
   * Unlike {@link applyBalanceDelta} (a realized-PnL increment), this is an
   * absolute "my real balance is now X" assertion from the Risk Profile screen,
   * so it sets `accountBalance` directly and recomputes drawdown against the
   * existing period-open and peak balances. Peak ratchets up if the new balance
   * exceeds it. Sticky breach flags are preserved — a manual top-up does not
   * clear a tripped breaker; only the period reset does. When no drawdown row
   * exists yet, it is lazily created seeded from the (already-updated) risk
   * profile balance, which equals this value. Runs inside the caller's
   * transaction so the profile and drawdown balances move atomically.
   */
  async setManualBalance(
    db: Db,
    userId: string,
    balance: number,
  ): Promise<void> {
    const existing = await db.drawdownState.findUnique({ where: { userId } });
    if (!existing) {
      // Seeds every balance field from riskProfile.accountBalance, which the
      // caller updates in the same transaction — i.e. exactly `balance`.
      await this.getOrCreateRow(userId, db);
      return;
    }

    const existingPeakBalance = toNumber(existing.peakBalance);
    const dailyOpenBalance = toNumber(existing.dailyOpenBalance);
    const weeklyOpenBalance = toNumber(existing.weeklyOpenBalance);
    const monthlyOpenBalance = toNumber(existing.monthlyOpenBalance);
    const roundedBalance = roundCurrency(balance);
    const peakBalance = Math.max(existingPeakBalance, roundedBalance);
    const dd = calculateDrawdown(
      roundedBalance,
      dailyOpenBalance,
      weeklyOpenBalance,
      monthlyOpenBalance,
      peakBalance,
    );

    await db.drawdownState.update({
      where: { userId },
      data: {
        accountBalance: roundedBalance,
        peakBalance,
        dailyDrawdownPct: dd.daily,
        weeklyDrawdownPct: dd.weekly,
        monthlyDrawdownPct: dd.monthly,
        allTimeDrawdownPct: dd.allTime,
      },
    });
  }

  /**
   * Circuit-breaker reset (spec §11.4), keyed to each user's local timezone.
   * Intended to run hourly; for every user it resets only on the first run that
   * lands on a new local calendar day, so the daily breaker opens at their local
   * midnight, the weekly on local Monday, and the monthly on the local 1st.
   *
   * Boundaries are computed from the user's IANA `timezone` via {@link localParts}
   * so DST is applied automatically (no stored numeric offsets), and the
   * `lastResetLocalDate` guard makes each user's reset fire exactly once per local
   * day — DST-safe (a missing 00:00 hour is a non-event) and idempotent if the
   * job is retried after a mid-loop failure.
   */
  async resetCircuitBreakers(now: Date = new Date()): Promise<void> {
    const rows = await this.prisma.drawdownState.findMany({
      include: { user: { select: { timezone: true } } },
    });

    for (const row of rows) {
      const { date, isMonday, isMonthStart } = localParts(
        now,
        row.user?.timezone,
      );
      // Already reset on this local day — skip (idempotent across retries, and
      // never double-fires when the hourly job runs again the same local day).
      if (row.lastResetLocalDate === date) continue;

      const accountBalance = toNumber(row.accountBalance);
      await this.prisma.drawdownState.update({
        where: { userId: row.userId },
        data: {
          dailyOpenBalance: accountBalance,
          dailyDrawdownPct: 0,
          dailyBreached: false,
          lastResetLocalDate: date,
          ...(isMonday
            ? {
                weeklyOpenBalance: accountBalance,
                weeklyDrawdownPct: 0,
                weeklyBreached: false,
              }
            : {}),
          ...(isMonthStart
            ? {
                monthlyOpenBalance: accountBalance,
                monthlyDrawdownPct: 0,
                monthlyBreached: false,
              }
            : {}),
        },
      });
    }
  }
}

/**
 * Resolves an instant into a user's local calendar parts using their IANA
 * timezone. Uses Intl so DST is applied for the given instant; falls back to UTC
 * when the timezone is missing or not a recognised IANA name (it is stored as a
 * free-form string), so one bad value can't break the whole reset loop.
 */
export function localParts(
  now: Date,
  timezone?: string | null,
): { date: string; isMonday: boolean; isMonthStart: boolean } {
  const tz = timezone || 'UTC';
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
  }
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  // en-CA yields YYYY-MM-DD ordering.
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  return {
    date,
    isMonday: get('weekday') === 'Mon',
    isMonthStart: get('day') === '01',
  };
}
