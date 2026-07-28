import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import axios from 'axios';
import { AvailableSymbols, fmpList } from './dto/quote-list.dto';
import { Server } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import {
  Currencies,
  FxMarketQuote,
  FxMarketQuoteSnapshot,
  FxQuote,
  FX_MARKET_QUOTE,
  FX_QUOTE,
} from './interface/quote.interface';

const forex_url = 'https://financialmodelingprep.com/stable';

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private availableForexCache: AvailableSymbols[] | null = null;
  private availableForexCachedAt = 0;
  private availableForexRetryAfter = 0;
  private availableForexRequest: Promise<AvailableSymbols[]> | null = null;

  /**
   * The forex pair list changes rarely, so cache it in-process and only re-hit
   * the upstream provider once per TTL window (SCRUM-16). Refreshing on a TTL —
   * rather than caching forever — is what lets a newly added pair appear without
   * a server restart, while keeping the list served instantly the rest of the time.
   */
  private static readonly AVAILABLE_FOREX_TTL_MS = 48 * 60 * 60 * 1000; // 48h
  private static readonly AVAILABLE_FOREX_RETRY_DELAY_MS = 60 * 1000; // 1 minute

  /**
   * The same quote→account conversion rate is resolved repeatedly for one trade:
   * the display exchange-rate path (get-exchange-rate) and the risk engine's
   * resolveExchangeRate, which re-runs on every debounced /risk/calculate. Caching
   * each base/quote for a short TTL (with single-flight de-dup) collapses those
   * redundant upstream calls into one and keeps the displayed rate and the rate
   * governance sizes on in sync. The one-shot entry quote (get-quote) and live
   * auto-close monitoring deliberately bypass this and call fxRate() directly.
   */
  private readonly fxRateCache = new Map<
    string,
    { price: number; at: number }
  >();
  private readonly fxRateInflight = new Map<
    string,
    Promise<{ price: number }>
  >();
  private readonly fxRateRetryAfter = new Map<string, number>();
  private static readonly FX_RATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly FX_RATE_RETRY_DELAY_MS = 60 * 1000; // 1 minute
  // A provider outage may temporarily use a known-good rate, but never allow
  // that fallback to become an indefinitely refreshed value.
  private static readonly FX_RATE_MAX_STALE_MS = 60 * 60 * 1000; // 1 hour

  server: Server;

  constructor(
    @Inject(FX_QUOTE) private readonly fxQuote: FxQuote,
    @Inject(FX_MARKET_QUOTE) private readonly fxMarketQuote: FxMarketQuote,
    private readonly configService: ConfigService,
  ) {}

  async getFMPList(): Promise<fmpList[]> {
    const fmpClient = axios.create({
      method: 'get',
      baseURL: forex_url,
    });
    const fmpApiKey = this.configService.get<string>('FMP_API_KEY');
    if (!fmpApiKey) throw new Error('FMP API key is required');
    try {
      const { data } = await fmpClient.request<fmpList[]>({
        url: '/forex-list',
        params: {
          apikey: fmpApiKey,
        },
      });
      return data;
    } catch (error) {
      console.log('error: ', error);
      this.logger.error('Error fetching available forex', error);
      Sentry.captureException(error, { extra: { context: 'getFMPList' } });
      throw new Error('Failed to fetch available forex');
    }
  }

  // This service can be expanded to include methods for fetching quotes, processing data, etc.
  // For now, it serves as a placeholder for future functionality related to quotes.
  async getAvailableForex(): Promise<AvailableSymbols[]> {
    const isFresh =
      this.availableForexCache !== null &&
      Date.now() - this.availableForexCachedAt <
        QuoteService.AVAILABLE_FOREX_TTL_MS;
    if (isFresh) {
      return this.availableForexCache as AvailableSymbols[];
    }
    if (
      this.availableForexCache !== null &&
      Date.now() < this.availableForexRetryAfter
    ) {
      return this.availableForexCache;
    }

    if (!this.availableForexRequest) {
      this.availableForexRequest = (async () => {
        try {
          const available = await this.getFMPList();
          const data = available.map((data) => ({
            symbol: data.symbol,
            currency: data.toCurrency,
          }));

          this.availableForexCache = data;
          this.availableForexCachedAt = Date.now();
          this.availableForexRetryAfter = 0;
          return data;
        } catch (error) {
          if (this.availableForexCache) {
            this.availableForexRetryAfter =
              Date.now() + QuoteService.AVAILABLE_FOREX_RETRY_DELAY_MS;
            return this.availableForexCache;
          }

          this.logger.error('Error fetching available forex', error);
          Sentry.captureException(error, {
            extra: { context: 'getAvailableForex' },
          });
          throw new Error('Failed to fetch available forex');
        } finally {
          this.availableForexRequest = null;
        }
      })();
    }

    return this.availableForexRequest;
  }

  clearAvailableForexCache() {
    this.availableForexCache = null;
    this.availableForexCachedAt = 0;
    this.availableForexRetryAfter = 0;
  }

  async refreshAvailableForex(): Promise<AvailableSymbols[]> {
    this.clearAvailableForexCache();

    try {
      return await this.getAvailableForex();
    } catch (error) {
      if (!this.availableForexCache) {
        this.logger.error('Error fetching available forex', error);
        Sentry.captureException(error, {
          extra: { context: 'refreshAvailableForex' },
        });
        throw new Error('Failed to fetch available forex');
      }

      return this.availableForexCache;
    }
  }

  async search(query: string): Promise<AvailableSymbols[]> {
    const quotes = await this.getAvailableForex();
    return quotes.filter(
      (item) =>
        item.symbol.toLowerCase().includes(query.toLowerCase()) ||
        item.currency.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
  }

  async quote(symbol: string) {
    try {
      const data = await this.getAvailableForex();
      return data;
    } catch (error) {
      this.logger.error(`Error fetching price for ${symbol}`, error);
      Sentry.captureException(error, { extra: { symbol, context: 'quote' } });
      throw error; // Re-throw to let Bull handle retries or failures
    }
  }

  async getMarketQuote(symbol: {
    base: string;
    quote: string;
  }): Promise<FxMarketQuoteSnapshot> {
    try {
      return await this.fxMarketQuote.getMarketQuote(symbol as Currencies);
    } catch (error) {
      this.logger.error(
        `Error fetching market quote for ${symbol.base}/${symbol.quote}`,
        error,
      );
      Sentry.captureException(error, {
        extra: { symbol, context: 'getMarketQuote' },
      });
      throw error;
    }
  }

  /**
   * Raw quote straight from the provider (no caching). Used for the one-shot
   * entry-price quote (get-quote) and live auto-close monitoring, which must
   * always see the freshest price.
   */
  async fxRate(symbol: {
    base: string;
    quote: string;
  }): Promise<{ price: number }> {
    try {
      const mapCurrency: Record<string, number> = {
        JPY: 3,
        XAG: 3,
        XAU: 2,
      };

      const { price } = await this.fxQuote.fxRate(symbol as Currencies);
      let cleanPrice = price.toFixed(5);
      if (mapCurrency[symbol.base] || mapCurrency[symbol.quote])
        cleanPrice = price.toFixed(
          mapCurrency[symbol.quote] ?? mapCurrency[symbol.base],
        );
      return { price: Number(cleanPrice) };
    } catch (error) {
      this.logger.error(
        `Error fetching price for ${symbol.base}/${symbol.quote}`,
        error,
      );
      Sentry.captureException(error, { extra: { symbol, context: 'fx rate' } });
      throw error;
    }
  }

  /**
   * Cached quote→account conversion rate (5-min TTL + single-flight). Used by the
   * display exchange-rate path (get-exchange-rate) and the risk engine's
   * resolveExchangeRate, which re-resolve the same rate repeatedly for one trade.
   */
  async cachedFxRate(symbol: {
    base: string;
    quote: string;
  }): Promise<{ price: number }> {
    const key = `${symbol.base}/${symbol.quote}`.toUpperCase();

    const cached = this.fxRateCache.get(key);
    if (cached && Date.now() - cached.at < QuoteService.FX_RATE_TTL_MS) {
      return { price: cached.price };
    }

    const retryAfter = this.fxRateRetryAfter.get(key);
    const retryCheckedAt = Date.now();
    if (
      cached &&
      retryAfter !== undefined &&
      retryCheckedAt < retryAfter &&
      retryCheckedAt - cached.at <= QuoteService.FX_RATE_MAX_STALE_MS
    ) {
      return { price: cached.price };
    }

    // Collapse concurrent resolutions of the same rate into one upstream call.
    const inflight = this.fxRateInflight.get(key);
    if (inflight) return inflight;

    const request = (async () => {
      try {
        const result = await this.fxRate(symbol);
        this.fxRateCache.set(key, { price: result.price, at: Date.now() });
        this.fxRateRetryAfter.delete(key);
        return result;
      } catch (error) {
        // Keep the risk engine available during a short provider outage by
        // serving the last-known rate. Preserve its original timestamp so the
        // fallback cannot extend its own lifetime indefinitely. A cold-cache or
        // excessively stale failure must still reach the caller.
        if (
          cached &&
          Date.now() - cached.at <= QuoteService.FX_RATE_MAX_STALE_MS
        ) {
          this.fxRateRetryAfter.set(
            key,
            Date.now() + QuoteService.FX_RATE_RETRY_DELAY_MS,
          );
          return { price: cached.price };
        }
        this.fxRateRetryAfter.delete(key);
        throw error;
      } finally {
        this.fxRateInflight.delete(key);
      }
    })();

    this.fxRateInflight.set(key, request);
    return request;
  }

  /** Stores a derived rate (for example, an inverted provider quote). */
  cacheFxRate(symbol: { base: string; quote: string }, price: number): void {
    const key = `${symbol.base}/${symbol.quote}`.toUpperCase();
    this.fxRateCache.set(key, { price, at: Date.now() });
    this.fxRateRetryAfter.delete(key);
  }
}
