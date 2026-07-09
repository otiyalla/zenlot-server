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
  private availableForexRequest: Promise<AvailableSymbols[]> | null = null;

  /**
   * The forex pair list changes rarely, so cache it in-process and only re-hit
   * the upstream provider once per TTL window (SCRUM-16). Refreshing on a TTL —
   * rather than caching forever — is what lets a newly added pair appear without
   * a server restart, while keeping the list served instantly the rest of the time.
   */
  private static readonly AVAILABLE_FOREX_TTL_MS = 48 * 60 * 60 * 1000; // 48h

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
          return data;
        } catch (error) {
          if (this.availableForexCache) {
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

  async fxRate(symbol: { base: string; quote: string }) {
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
}
