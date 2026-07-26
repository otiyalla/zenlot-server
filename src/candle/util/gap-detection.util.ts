import { Candle } from '../interface/candle.interface';

export type GapReason = 'cold' | 'head' | 'tail' | 'stale';

export interface CandleGap {
  /** Inclusive start (epoch ms). */
  from: number;
  /** Inclusive end (epoch ms). */
  to: number;
  reason: GapReason;
}

function isForexWeekend(timestamp: number): boolean {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();

  return day === 6 || (day === 0 && hour < 22) || (day === 5 && hour >= 22);
}

/**
 * A tail is covered when every bar that could follow the cached bar falls in
 * the regular Friday 22:00–Sunday 22:00 UTC forex closure. This deliberately
 * stays conservative: holidays and provider-specific closures are still
 * fetched because they cannot be inferred reliably here.
 */
function isClosedMarketTail(dbMax: number, to: number, barMs: number): boolean {
  let nextBar = dbMax + barMs;
  if (nextBar > to) return false;

  while (nextBar <= to) {
    if (!isForexWeekend(nextBar)) return false;
    nextBar += barMs;
  }

  return true;
}

/**
 * Decide which sub-ranges of [from, to] must be fetched upstream, given the
 * bars already cached. Implements the PDF's cold/head/tail/stale model:
 *
 *  - cold:  nothing cached     -> fetch the whole window.
 *  - head:  requested start is older than the oldest cached bar.
 *  - tail:  requested end is newer than the newest cached bar.
 *  - stale: the newest cached bar is recent enough to still be forming, so it
 *           must be re-fetched even when the window is otherwise covered.
 *
 * Internal holes are intentionally NOT treated as gaps: forex has weekend/
 * holiday closures, so a missing bar mid-window is usually a real market gap,
 * not a cache miss. Re-fetching those every request would waste the API budget.
 *
 * `existing` must be ascending by `ts`.
 */
export function detectGaps(
  existing: Candle[],
  from: number,
  to: number,
  barMs: number,
  now: number = Date.now(),
): CandleGap[] {
  if (existing.length === 0) {
    return [{ from, to, reason: 'cold' }];
  }

  const gaps: CandleGap[] = [];
  const dbMin = existing[0].ts;
  const dbMax = existing[existing.length - 1].ts;

  if (from < dbMin) {
    gaps.push({ from, to: dbMin, reason: 'head' });
  }

  if (to > dbMax) {
    if (!isClosedMarketTail(dbMax, to, barMs)) {
      gaps.push({ from: dbMax, to, reason: 'tail' });
    }
  } else if (dbMax >= now - 2 * barMs) {
    // Window is covered, but the latest bar is fresh enough that it may still
    // be forming — refresh it (and anything up to now) so the open bar updates.
    gaps.push({ from: dbMax, to: now, reason: 'stale' });
  }

  return gaps;
}
