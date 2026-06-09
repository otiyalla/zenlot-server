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
    if (!fmpApiKey) throw 'FMP API key is required';
    try {
      const { data } = await fmpClient({
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
    let data: AvailableSymbols[] = [];

    try {
      const available = await this.getFMPList();
      if (available.length) {
        data = available.map((data) => {
          return {
            symbol: data.symbol,
            currency: data.toCurrency,
          };
        });
      }
      return data;
    } catch (error) {
      if (error) {
        data = [];
      }
      if (!data.length) {
        this.logger.error('Error fetching available forex', error);
        Sentry.captureException(error, {
          extra: { context: 'getAvailableForex' },
        });
        throw new Error('Failed to fetch available forex');
      }
      return data;
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
      const mapCurrency = {
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
      this.logger.error(`Error fetching price for ${symbol}`, error);
      Sentry.captureException(error, { extra: { symbol, context: 'fx rate' } });
      throw error;
    }
  }
}
