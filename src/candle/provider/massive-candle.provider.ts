import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  Candle,
  CandleProvider,
  CandleSource,
  Timeframe,
} from '../interface/candle.interface';
import { toMassiveTicker } from '../util/symbol.util';
import { timeframeSpec } from '../util/timeframe.util';
import { sanitizeApiKey } from '../util/api-key.util';

const MASSIVE_BASE_URL = 'https://api.massive.com';
const MAX_LIMIT = 50000;

interface MassiveBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface MassiveResponse {
  status?: string;
  error?: string;
  message?: string;
  results?: MassiveBar[];
}

/** Third fallback candle source: Massive forex aggregate bars. */
@Injectable()
export class MassiveCandleProvider implements CandleProvider {
  readonly source: CandleSource = 'massive';
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = sanitizeApiKey(
      this.configService.get<string>('MASSIVE_API_KEY'),
    );
    this.client = axios.create({
      baseURL: MASSIVE_BASE_URL,
      method: 'get',
      timeout: 10_000,
    });
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
      throw new Error('MASSIVE_API_KEY is not configured');
    }

    const ticker = toMassiveTicker(pair);
    const { multiplier, timespan } = timeframeSpec(timeframe).massive;

    const { data } = await this.client<MassiveResponse>({
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
        data.error ?? data.message ?? `Massive request failed for ${ticker}`,
      );
    }

    return (data.results ?? [])
      .map(parseBar)
      .filter((bar): bar is Candle => bar !== null)
      .sort((a, b) => a.ts - b.ts);
  }
}

function parseBar(bar: MassiveBar): Candle | null {
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
