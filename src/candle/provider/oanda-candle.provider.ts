import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  Candle,
  CandleProvider,
  CandleSource,
  Timeframe,
} from '../interface/candle.interface';
import { toOandaInstrument } from '../util/symbol.util';
import { timeframeSpec } from '../util/timeframe.util';
import { sanitizeApiKey } from '../util/api-key.util';

const OANDA_PRACTICE_URL = 'https://api-fxpractice.oanda.com';
const OANDA_LIVE_URL = 'https://api-fxtrade.oanda.com';

interface OandaCandle {
  time: string;
  volume?: number;
  complete?: boolean;
  mid?: { o: string; h: string; l: string; c: string };
}

interface OandaResponse {
  candles?: OandaCandle[];
  errorMessage?: string;
}

/**
 * Backup candle source. Free practice account + token; deep history, generous
 * rate limit, real OANDA forex data. Uses mid prices.
 */
@Injectable()
export class OandaCandleProvider implements CandleProvider {
  readonly source: CandleSource = 'oanda';
  private readonly logger = new Logger(OandaCandleProvider.name);
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = sanitizeApiKey(
      this.configService.get<string>('OANDA_API_KEY'),
    );
    const live = (this.configService.get<string>('OANDA_ENVIRONMENT') ?? '')
      .toLowerCase()
      .startsWith('live');
    this.client = axios.create({
      baseURL: live ? OANDA_LIVE_URL : OANDA_PRACTICE_URL,
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
      throw new Error('OANDA_API_KEY is not configured');
    }

    const instrument = toOandaInstrument(pair);
    const granularity = timeframeSpec(timeframe).oanda;
    // OANDA rejects a `to` in the future.
    const safeTo = Math.min(to, Date.now());

    const { data } = await this.client<OandaResponse>({
      url: `/v3/instruments/${instrument}/candles`,
      headers: { Authorization: `Bearer ${this.apiKey}` },
      params: {
        price: 'M',
        granularity,
        from: new Date(from).toISOString(),
        to: new Date(safeTo).toISOString(),
      },
    });

    const candles = data.candles ?? [];
    return candles
      .map((bar) => parseBar(bar))
      .filter((bar): bar is Candle => bar !== null)
      .sort((a, b) => a.ts - b.ts);
  }
}

function parseBar(bar: OandaCandle): Candle | null {
  if (!bar.mid) {
    return null;
  }
  const ts = Date.parse(bar.time);
  const open = Number(bar.mid.o);
  const high = Number(bar.mid.h);
  const low = Number(bar.mid.l);
  const close = Number(bar.mid.c);
  if (![ts, open, high, low, close].every(Number.isFinite)) {
    return null;
  }
  return {
    ts,
    open,
    high,
    low,
    close,
    volume: typeof bar.volume === 'number' ? bar.volume : undefined,
  };
}
