/**
 * A single OHLC bar. `ts` is the bar's open time in epoch milliseconds (UTC).
 * `volume` is optional because not every forex provider reports it.
 */
export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Supported chart timeframes. */
export type Timeframe = 'M15' | 'H1' | 'H4' | 'D1';

export const TIMEFRAMES: Timeframe[] = ['M15', 'H1', 'H4', 'D1'];

export function isTimeframe(value: string): value is Timeframe {
  return (TIMEFRAMES as string[]).includes(value);
}

/** Upstream market-data sources, in fallback priority order. */
export type CandleSource = 'twelvedata' | 'oanda' | 'polygon';

/**
 * Every candle provider implements this. Implementations are responsible for
 * translating the canonical pair (e.g. "EURUSD") into their own symbol format
 * and the timeframe into their own interval/granularity parameter.
 *
 * `isConfigured()` lets the service skip providers whose API key is absent so a
 * missing key degrades gracefully instead of throwing.
 */
export interface CandleProvider {
  readonly source: CandleSource;
  isConfigured(): boolean;
  /** Fetch bars with open time in [from, to] (inclusive). Ascending by ts. */
  fetchCandles(
    pair: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]>;
}

export const CANDLE_PROVIDERS = Symbol('CANDLE_PROVIDERS');
