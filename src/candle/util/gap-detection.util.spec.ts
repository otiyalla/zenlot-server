import { detectGaps } from './gap-detection.util';
import { Candle } from '../interface/candle.interface';

const HOUR = 60 * 60 * 1000;

function bar(ts: number): Candle {
  return { ts, open: 1, high: 1, low: 1, close: 1 };
}

describe('detectGaps', () => {
  // A fixed "now" well after the test windows so nothing is considered forming.
  const now = 1_000 * HOUR;

  it('returns a single cold gap covering the whole window when nothing is cached', () => {
    const gaps = detectGaps([], 10 * HOUR, 20 * HOUR, HOUR, now);
    expect(gaps).toEqual([{ from: 10 * HOUR, to: 20 * HOUR, reason: 'cold' }]);
  });

  it('detects a head gap when the request starts before the oldest cached bar', () => {
    const existing = [bar(15 * HOUR), bar(16 * HOUR)];
    const gaps = detectGaps(existing, 10 * HOUR, 16 * HOUR, HOUR, now);
    expect(gaps).toContainEqual({
      from: 10 * HOUR,
      to: 15 * HOUR,
      reason: 'head',
    });
  });

  it('ignores a partial head interval shorter than one bar', () => {
    const existing = [bar(15 * HOUR), bar(16 * HOUR)];
    const gaps = detectGaps(
      existing,
      15 * HOUR - HOUR / 2,
      16 * HOUR,
      HOUR,
      now,
    );
    expect(gaps).toEqual([]);
  });

  it('detects a tail gap when the request ends after the newest cached bar', () => {
    const existing = [bar(15 * HOUR), bar(16 * HOUR)];
    const gaps = detectGaps(existing, 15 * HOUR, 20 * HOUR, HOUR, now);
    expect(gaps).toContainEqual({
      from: 16 * HOUR,
      to: 20 * HOUR,
      reason: 'tail',
    });
  });

  it.each([
    {
      season: 'daylight time',
      finalBar: Date.UTC(2026, 6, 24, 20),
      weekend: Date.UTC(2026, 6, 25, 12),
    },
    {
      season: 'standard time',
      finalBar: Date.UTC(2026, 0, 23, 21),
      weekend: Date.UTC(2026, 0, 24, 12),
    },
  ])(
    'does not refetch a weekend tail during $season',
    ({ finalBar, weekend }) => {
      const gaps = detectGaps(
        [bar(finalBar)],
        finalBar,
        weekend,
        HOUR,
        weekend + HOUR,
      );

      expect(gaps).toEqual([]);
    },
  );

  it('fetches a tail that extends through the Sunday market reopening', () => {
    const fridayAt21Utc = Date.UTC(2026, 6, 24, 21);
    const sundayAt23Utc = Date.UTC(2026, 6, 26, 23);

    const gaps = detectGaps(
      [bar(fridayAt21Utc)],
      fridayAt21Utc,
      sundayAt23Utc,
      HOUR,
      Date.UTC(2026, 6, 27),
    );

    expect(gaps).toContainEqual({
      from: fridayAt21Utc,
      to: sundayAt23Utc,
      reason: 'tail',
    });
  });

  it('fetches a missing open-market bar before the weekend closure', () => {
    const fridayAt19Utc = Date.UTC(2026, 6, 24, 19);
    const saturdayAt12Utc = Date.UTC(2026, 6, 25, 12);

    const gaps = detectGaps(
      [bar(fridayAt19Utc)],
      fridayAt19Utc,
      saturdayAt12Utc,
      HOUR,
      Date.UTC(2026, 6, 25, 13),
    );

    expect(gaps).toContainEqual({
      from: fridayAt19Utc,
      to: saturdayAt12Utc,
      reason: 'tail',
    });
  });

  it('returns no gaps when the window is fully covered and bars are old', () => {
    const existing = [bar(15 * HOUR), bar(16 * HOUR), bar(17 * HOUR)];
    const gaps = detectGaps(existing, 15 * HOUR, 17 * HOUR, HOUR, now);
    expect(gaps).toEqual([]);
  });

  it('flags a stale refetch when the newest cached bar is recent enough to be forming', () => {
    const recentNow = 100 * HOUR;
    // Newest bar is within 2x bar duration of now -> may still be forming.
    const existing = [bar(98 * HOUR), bar(99 * HOUR)];
    const gaps = detectGaps(existing, 98 * HOUR, 99 * HOUR, HOUR, recentNow);
    expect(gaps).toContainEqual({
      from: 99 * HOUR,
      to: recentNow,
      reason: 'stale',
    });
  });

  it('refreshes a recent cached bar through now for a covered historical sub-window', () => {
    const recentNow = 100 * HOUR;
    const existing = [bar(98 * HOUR), bar(99 * HOUR)];

    const gaps = detectGaps(existing, 98 * HOUR, 98 * HOUR, HOUR, recentNow);

    expect(gaps).toEqual([{ from: 99 * HOUR, to: recentNow, reason: 'stale' }]);
    expect(gaps.every((gap) => gap.from <= gap.to)).toBe(true);
  });

  it('does not double-count: a tail gap supersedes the stale refetch', () => {
    const recentNow = 100 * HOUR;
    const existing = [bar(98 * HOUR), bar(99 * HOUR)];
    const gaps = detectGaps(existing, 98 * HOUR, recentNow, HOUR, recentNow);
    expect(gaps.filter((g) => g.reason === 'stale')).toHaveLength(0);
    expect(gaps).toContainEqual({
      from: 99 * HOUR,
      to: recentNow,
      reason: 'tail',
    });
  });
});
