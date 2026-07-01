/**
 * Symbol normalization. Trades store the canonical 6-char form ("EURUSD"); each
 * provider wants its own layout. We always cache-key on the canonical form so
 * "EUR/USD" and "EURUSD" never fragment into duplicate cache rows.
 */

export interface ParsedPair {
  base: string;
  quote: string;
}

/** Strip separators/whitespace and upper-case: "eur/usd" -> "EURUSD". */
export function normalizePair(symbol: string): string {
  const cleaned = symbol.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (cleaned.length !== 6) {
    throw new Error(`Unsupported forex symbol: "${symbol}"`);
  }
  return cleaned;
}

/** "EURUSD" -> { base: "EUR", quote: "USD" }. Assumes a normalized pair. */
export function parsePair(pair: string): ParsedPair {
  return { base: pair.slice(0, 3), quote: pair.slice(3, 6) };
}

/** TwelveData expects "EUR/USD". */
export function toTwelveDataSymbol(pair: string): string {
  const { base, quote } = parsePair(pair);
  return `${base}/${quote}`;
}

/** OANDA v20 expects "EUR_USD". */
export function toOandaInstrument(pair: string): string {
  const { base, quote } = parsePair(pair);
  return `${base}_${quote}`;
}

/** Polygon.io forex tickers are prefixed with "C:" — "C:EURUSD". */
export function toPolygonTicker(pair: string): string {
  return `C:${pair}`;
}
