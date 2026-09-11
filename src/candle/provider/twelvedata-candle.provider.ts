import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  Candle,
  CandleProvider,
  CandleSource,
  Timeframe,
} from '../interface/candle.interface';
import { toTwelveDataSymbol } from '../util/symbol.util';
import { timeframeSpec } from '../util/timeframe.util';
import { sanitizeApiKey } from '../util/api-key.util';

const TWELVEDATA_BASE_URL = 'https://api.twelvedata.com';
const MAX_OUTPUTSIZE = 5000; // TwelveData hard cap per request.

interface TwelveDataBar {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

interface TwelveDataResponse {
  status?: string;
  message?: string;
  code?: number;
  values?: TwelveDataBar[];
}

/** Primary candle source: covers every supported timeframe incl. daily. */
@Injectable()
export class TwelveDataCandleProvider implements CandleProvider {
  readonly source: CandleSource = 'twelvedata';
  private readonly logger = new Logger(TwelveDataCandleProvider.name);
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = sanitizeApiKey(
      this.configService.get<string>('TWELVEDATA_API_KEY'),
    );
    this.client = axios.create({
      baseURL: TWELVEDATA_BASE_URL,
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
      throw new Error('TWELVEDATA_API_KEY is not configured');
    }

    const symbol = toTwelveDataSymbol(pair);
    const interval = timeframeSpec(timeframe).twelveData;

    const { data } = await this.client<TwelveDataResponse>({
      url: '/time_series',
      params: {
        symbol,
        interval,
        start_date: toUtcParam(from),
        end_date: toUtcParam(to),
        outputsize: MAX_OUTPUTSIZE,
        timezone: 'UTC',
        format: 'JSON',
        apikey: this.apiKey,
      },
    });

    if (data.status === 'error' || data.code !== undefined) {
      throw new Error(
        data.message ?? `TwelveData request failed for ${symbol}`,
      );
    }

    const values = data.values ?? [];
    return values
      .map((bar) => parseBar(bar))
      .filter((bar): bar is Candle => bar !== null)
      .sort((a, b) => a.ts - b.ts);
  }
}

/** TwelveData accepts "YYYY-MM-DD HH:mm:ss" in the requested timezone (UTC). */
function toUtcParam(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');
}

function parseBar(bar: TwelveDataBar): Candle | null {
  // Daily bars come back as "YYYY-MM-DD"; intraday as "YYYY-MM-DD HH:mm:ss".
  const iso = bar.datetime.includes(' ')
    ? `${bar.datetime.replace(' ', 'T')}Z`
    : `${bar.datetime}T00:00:00Z`;
  const ts = Date.parse(iso);
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  if (![ts, open, high, low, close].every(Number.isFinite)) {
    return null;
  }
  const volume = bar.volume !== undefined ? Number(bar.volume) : undefined;
  return {
    ts,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : undefined,
  };
}
