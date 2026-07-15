import { CandleSource } from '../interface/candle.interface';

/**
 * In-memory request budget + circuit breaker per upstream provider. The
 * read-through cache means most reads never hit a provider, but cold pairs can,
 * so we guard the free-tier daily quotas and back off when a provider returns
 * 429. State is per-instance (the deployment is a single EC2 box today); if it
 * ever scales horizontally this should move to Redis.
 */
interface BudgetState {
  /** Requests made in the current UTC day. */
  count: number;
  /** Epoch ms when the daily counter resets. */
  resetAt: number;
  /** Epoch ms until which the provider is circuit-broken (0 = open). */
  blockedUntil: number;
}

/** Conservative free-tier daily ceilings; 0 = effectively uncapped (per-day). */
const DAILY_BUDGET: Record<CandleSource, number> = {
  massive: 0,
  twelvedata: 800,
  oanda: 0,
};

const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class ProviderBudget {
  private readonly state = new Map<CandleSource, BudgetState>();

  private get(source: CandleSource, now: number): BudgetState {
    let s = this.state.get(source);
    if (!s) {
      s = { count: 0, resetAt: now + DAY_MS, blockedUntil: 0 };
      this.state.set(source, s);
    }
    if (now >= s.resetAt) {
      s.count = 0;
      s.resetAt = now + DAY_MS;
    }
    return s;
  }

  /** Whether the provider may be called right now. */
  canUse(source: CandleSource, now: number = Date.now()): boolean {
    const s = this.get(source, now);
    if (s.blockedUntil > now) {
      return false;
    }
    const budget = DAILY_BUDGET[source];
    return budget === 0 || s.count < budget;
  }

  recordSuccess(source: CandleSource, now: number = Date.now()): void {
    this.get(source, now).count += 1;
  }

  recordFailure(
    source: CandleSource,
    rateLimited: boolean,
    now: number = Date.now(),
  ): void {
    const s = this.get(source, now);
    s.count += 1;
    if (rateLimited) {
      s.blockedUntil = now + RATE_LIMIT_COOLDOWN_MS;
    }
  }
}
