import { Timeframe } from '../interface/candle.interface';

/**
 * Per-timeframe metadata: bar duration plus each provider's parameter spelling.
 * Centralized here so adding a timeframe is a one-line change.
 */
export interface TimeframeSpec {
  /** Bar duration in milliseconds. */
  durationMs: number;
  /** TwelveData `interval` value. */
  twelveData: string;
  /** OANDA `granularity` value. */
  oanda: string;
  /** Polygon aggregate `multiplier` + `timespan`. */
  polygon: { multiplier: number; timespan: 'minute' | 'hour' | 'day' };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const TIMEFRAME_SPECS: Record<Timeframe, TimeframeSpec> = {
  M15: {
    durationMs: 15 * MINUTE,
    twelveData: '15min',
    oanda: 'M15',
    polygon: { multiplier: 15, timespan: 'minute' },
  },
  H1: {
    durationMs: HOUR,
    twelveData: '1h',
    oanda: 'H1',
    polygon: { multiplier: 1, timespan: 'hour' },
  },
  H4: {
    durationMs: 4 * HOUR,
    twelveData: '4h',
    oanda: 'H4',
    polygon: { multiplier: 4, timespan: 'hour' },
  },
  D1: {
    durationMs: DAY,
    twelveData: '1day',
    oanda: 'D',
    polygon: { multiplier: 1, timespan: 'day' },
  },
};

export function timeframeSpec(timeframe: Timeframe): TimeframeSpec {
  return TIMEFRAME_SPECS[timeframe];
}
