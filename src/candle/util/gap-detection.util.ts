import { Candle } from '../interface/candle.interface';

export type GapReason = 'cold' | 'head' | 'tail' | 'stale';

export interface CandleGap {
  /** Inclusive start (epoch ms). */
  from: number;
  /** Inclusive end (epoch ms). */
  to: number;
  reason: GapReason;
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
    gaps.push({ from: dbMax, to, reason: 'tail' });
  } else if (dbMax >= now - 2 * barMs) {
    // Window is covered, but the latest bar is fresh enough that it may still
    // be forming — refresh it (and anything up to now) so the open bar updates.
    gaps.push({ from: dbMax, to: Math.min(to, now), reason: 'stale' });
  }

  return gaps;
}
