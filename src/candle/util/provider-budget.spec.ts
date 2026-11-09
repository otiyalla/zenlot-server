import { ProviderBudget } from './provider-budget';

describe('ProviderBudget', () => {
  it('counts only successful requests against the daily budget', () => {
    const budget = new ProviderBudget();
    const now = 1_000_000;

    for (let i = 0; i < 800; i += 1) {
      budget.recordFailure('twelvedata', false, now);
    }

    expect(budget.canUse('twelvedata', now + 60_000)).toBe(true);

    for (let i = 0; i < 800; i += 1) {
      budget.recordSuccess('twelvedata', now + 60_000);
    }

    expect(budget.canUse('twelvedata', now + 60_000)).toBe(false);
  });

  it('exponentially backs off non-rate-limit failures and resets on success', () => {
    const budget = new ProviderBudget();
    const now = 1_000_000;

    budget.recordFailure('twelvedata', false, now);
    expect(budget.canUse('twelvedata', now + 999)).toBe(false);
    expect(budget.canUse('twelvedata', now + 1_000)).toBe(true);

    budget.recordFailure('twelvedata', false, now + 1_000);
    expect(budget.canUse('twelvedata', now + 2_999)).toBe(false);
    expect(budget.canUse('twelvedata', now + 3_000)).toBe(true);

    budget.recordSuccess('twelvedata', now + 3_000);
    budget.recordFailure('twelvedata', false, now + 3_000);
    expect(budget.canUse('twelvedata', now + 4_000)).toBe(true);
  });

  it('uses the fixed cooldown for rate-limit failures', () => {
    const budget = new ProviderBudget();
    const now = 1_000_000;

    budget.recordFailure('twelvedata', true, now);

    expect(budget.canUse('twelvedata', now + 59_999)).toBe(false);
    expect(budget.canUse('twelvedata', now + 60_000)).toBe(true);
  });
});
