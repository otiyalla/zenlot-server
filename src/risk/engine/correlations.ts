/**
 * Static directional correlation table (spec Section 11.3).
 *
 * Pairs within the same group are treated as correlated when held in the SAME
 * direction (both long or both short). The table reflects typical market
 * conditions and intentionally does not adapt to live regime changes.
 */
export const CORRELATION_GROUPS: Record<string, string[]> = {
  // Long these = short USD
  USD_NEGATIVE: ['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'],
  // Long these = long USD
  USD_POSITIVE: ['USDCAD', 'USDCHF', 'USDJPY'],
  EUR_BLOC: [
    'EURUSD',
    'EURGBP',
    'EURJPY',
    'EURCHF',
    'EURAUD',
    'EURCAD',
    'EURNZD',
  ],
  GBP_BLOC: [
    'GBPUSD',
    'GBPJPY',
    'GBPAUD',
    'GBPCAD',
    'GBPCHF',
    'GBPNZD',
    'EURGBP',
  ],
  COMMODITY: ['AUDUSD', 'NZDUSD', 'USDCAD'],
  JPY_SAFE_HAVEN: [
    'USDJPY',
    'EURJPY',
    'GBPJPY',
    'AUDJPY',
    'CADJPY',
    'CHFJPY',
    'NZDJPY',
  ],
};

/** Fixed UI disclaimer surfaced on the correlated-exposure badge (spec Section 11.3). */
export const CORRELATION_DISCLAIMER = (language: string) => {
  if (language === 'fr') {
    return 'Les corrélations sont des estimations basées sur les conditions de marché typiques et peuvent ne pas tenir pendant les événements de grande ampleur.';
  }
  return 'Correlations are estimates based on typical market conditions and may not hold during high-impact events.';
};

/**
 * Returns every pair correlated with `pair` (i.e. sharing at least one group),
 * excluding the pair itself. Direction is taken into account by the caller:
 * two trades are correlated exposure only when they share a group AND are in the
 * same direction.
 */
export function getCorrelatedPairs(pair: string): string[] {
  const target = pair.toUpperCase();
  const correlated = new Set<string>();
  for (const group of Object.values(CORRELATION_GROUPS)) {
    if (group.includes(target)) {
      group.filter((p) => p !== target).forEach((p) => correlated.add(p));
    }
  }
  return [...correlated];
}
