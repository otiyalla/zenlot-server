import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  Candle,
  CandleProvider,
  CandleSource,
  Timeframe,
} from '../interface/candle.interface';
import { toPolygonTicker } from '../util/symbol.util';
import { timeframeSpec } from '../util/timeframe.util';
import { sanitizeApiKey } from '../util/api-key.util';

const POLYGON_BASE_URL = 'https://api.polygon.io';
const MAX_LIMIT = 50000;

interface PolygonBar {
  t: number; // epoch ms (bar start)
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface PolygonResponse {
  status?: string;
  error?: string;
  message?: string;
  results?: PolygonBar[];
}

/** Third fallback candle source: clean REST, ~2yr forex history. */
@Injectable()
export class PolygonCandleProvider implements CandleProvider {
  readonly source: CandleSource = 'polygon';
  private readonly logger = new Logger(PolygonCandleProvider.name);
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = sanitizeApiKey(
      this.configService.get<string>('POLYGON_API_KEY'),
    );
    this.client = axios.create({ baseURL: POLYGON_BASE_URL, method: 'get' });
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async fetchCandles(
    pair: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    if (!this.apiKey) {
      throw new Error('POLYGON_API_KEY is not configured');
    }

    const ticker = toPolygonTicker(pair);
    const { multiplier, timespan } = timeframeSpec(timeframe).polygon;

    const { data } = await this.client<PolygonResponse>({
      url: `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}`,
      params: {
        adjusted: true,
        sort: 'asc',
        limit: MAX_LIMIT,
        apiKey: this.apiKey,
      },
    });

    if (data.status === 'ERROR') {
      throw new Error(
        data.error ?? data.message ?? `Polygon request failed for ${ticker}`,
      );
    }

    const results = data.results ?? [];
    return results
      .map((bar) => parseBar(bar))
      .filter((bar): bar is Candle => bar !== null)
      .sort((a, b) => a.ts - b.ts);
  }
}

function parseBar(bar: PolygonBar): Candle | null {
  const { t: ts, o: open, h: high, l: low, c: close } = bar;
  if (![ts, open, high, low, close].every(Number.isFinite)) {
    return null;
  }
  return {
    ts,
    open,
    high,
    low,
    close,
    volume: typeof bar.v === 'number' ? bar.v : undefined,
  };
}
