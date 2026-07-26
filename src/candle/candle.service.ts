import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  Candle,
  CANDLE_PROVIDERS,
  CandleProvider,
  CandleSource,
  Timeframe,
} from './interface/candle.interface';
import { normalizePair } from './util/symbol.util';
import { timeframeSpec } from './util/timeframe.util';
import { detectGaps } from './util/gap-detection.util';
import { ProviderBudget } from './util/provider-budget';

export interface CandleDto {
  /** UNIX timestamp in seconds (UTC) — the shape lightweight-charts expects. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CandleSeries {
  symbol: string;
  timeframe: Timeframe;
  /** Decimal places this pair quotes to (5 default, 3 for JPY/XAG, 2 for XAU). */
  precision: number;
  candles: CandleDto[];
}

interface FetchResult {
  candles: Candle[];
  source: CandleSource;
}

/** Default bars to return when the caller doesn't bound the window. */
const DEFAULT_BAR_COUNT = 300;
/** Maximum number of bars accepted in a single request. */
const MAX_BAR_COUNT = 300;
/** Upsert chunk size to keep transactions bounded. */
const UPSERT_CHUNK = 200;

const PRICE_PRECISION: Record<string, number> = { JPY: 3, XAG: 3, XAU: 2 };

@Injectable()
export class CandleService {
  private readonly logger = new Logger(CandleService.name);
  private readonly budget = new ProviderBudget();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CANDLE_PROVIDERS)
    private readonly providers: CandleProvider[],
  ) {}

  /**
   * Read-through cache entry point. Returns the requested window from Postgres,
   * fetching+persisting any missing/stale sub-ranges from upstream first. If all
   * providers fail, whatever is already cached is still returned (degraded, not
   * an error) so a transient upstream outage doesn't break the chart.
   */
  async getCandles(params: {
    symbol: string;
    timeframe: Timeframe;
    from?: number;
    to?: number;
  }): Promise<CandleSeries> {
    const pair = normalizePair(params.symbol);
    const spec = timeframeSpec(params.timeframe);
    const now = Date.now();

    // Bound the window. Default to the last DEFAULT_BAR_COUNT bars; never allow
    // a `to` beyond the current forming bar or an upstream fetch spanning more
    // than MAX_BAR_COUNT bars.
    const to = Math.min(params.to ?? now, now + spec.durationMs);
    const from = params.from ?? to - DEFAULT_BAR_COUNT * spec.durationMs;
    if (from >= to) {
      throw new BadRequestException(
        'Candle window start must be earlier than its end',
      );
    }
    if (to - from > MAX_BAR_COUNT * spec.durationMs) {
      throw new BadRequestException(
        `Candle window cannot exceed ${MAX_BAR_COUNT} ${params.timeframe} bars`,
      );
    }

    let existing = await this.readRange(pair, params.timeframe, from, to);
    const gaps = detectGaps(existing, from, to, spec.durationMs, now);

    if (gaps.length > 0) {
      for (const gap of gaps) {
        const result = await this.fetchFromProviders(
          pair,
          params.timeframe,
          gap.from,
          gap.to,
        );
        if (result && result.candles.length > 0) {
          await this.upsertCandles(
            pair,
            params.timeframe,
            result.candles,
            result.source,
          );
        }
      }
      existing = await this.readRange(pair, params.timeframe, from, to);
    }

    return {
      symbol: pair,
      timeframe: params.timeframe,
      precision: this.precisionFor(pair),
      candles: existing.map((c) => ({
        time: Math.floor(c.ts / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    };
  }

  /**
   * Fetch the freshest bar for the live feed: refreshes a small recent window
   * (which re-fetches the forming bar via the stale-gap path) and returns the
   * latest bar, or null if none is available.
   */
  async getLiveBar(
    symbol: string,
    timeframe: Timeframe,
  ): Promise<CandleDto | null> {
    const spec = timeframeSpec(timeframe);
    const now = Date.now();
    const series = await this.getCandles({
      symbol,
      timeframe,
      from: now - 3 * spec.durationMs,
      to: now,
    });
    const { candles } = series;
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }

  private precisionFor(pair: string): number {
    const base = pair.slice(0, 3);
    const quote = pair.slice(3, 6);
    return PRICE_PRECISION[quote] ?? PRICE_PRECISION[base] ?? 5;
  }

  private async readRange(
    pair: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<Candle[]> {
    const rows = await this.prisma.candle.findMany({
      where: {
        pair,
        timeframe,
        ts: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { ts: 'asc' },
    });
    return rows.map((r) => ({
      ts: r.ts.getTime(),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume ?? undefined,
    }));
  }

  /** Try each provider in priority order until one returns data. */
  private async fetchFromProviders(
    pair: string,
    timeframe: Timeframe,
    from: number,
    to: number,
  ): Promise<FetchResult | null> {
    for (const provider of this.providers) {
      if (!provider.isConfigured() || !this.budget.canUse(provider.source)) {
        continue;
      }
      try {
        const candles = await provider.fetchCandles(pair, timeframe, from, to);
        this.budget.recordSuccess(provider.source);
        return { candles, source: provider.source };
      } catch (error) {
        const rateLimited =
          axios.isAxiosError(error) && error.response?.status === 429;
        this.budget.recordFailure(provider.source, rateLimited);
        this.logger.warn(
          `Candle provider ${provider.source} failed for ${pair} ${timeframe} (${rateLimited ? 'rate-limited' : 'error'}): ${(error as Error).message}`,
        );
        Sentry.captureException(error, {
          extra: {
            context: 'fetchFromProviders',
            provider: provider.source,
            pair,
            timeframe,
          },
        });
      }
    }
    this.logger.warn(
      `All candle providers exhausted for ${pair} ${timeframe}; serving cache only`,
    );
    return null;
  }

  /**
   * Persist fetched bars. Inserts new bars and updates existing ones (so the
   * forming/last bar refreshes). Chunked upserts in a transaction.
   */
  private async upsertCandles(
    pair: string,
    timeframe: Timeframe,
    candles: Candle[],
    source: CandleSource,
  ): Promise<void> {
    for (let i = 0; i < candles.length; i += UPSERT_CHUNK) {
      const chunk = candles.slice(i, i + UPSERT_CHUNK);
      await this.prisma.$transaction(
        chunk.map((c) => {
          const data = {
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume ?? null,
            source,
          };
          return this.prisma.candle.upsert({
            where: {
              pair_timeframe_ts: { pair, timeframe, ts: new Date(c.ts) },
            },
            create: { pair, timeframe, ts: new Date(c.ts), ...data },
            update: data,
          });
        }),
      );
    }
  }
}
