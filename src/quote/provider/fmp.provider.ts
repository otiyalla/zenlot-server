import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { Currencies, FxQuote } from '../interface/quote.interface';
import { sanitizeApiKey } from '../../candle/util/api-key.util';

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

type ParsedCurrencies = {
  base: string;
  quote: string;
};

type FmpQuoteResponse = {
  symbol?: string;
  price?: number | string;
};

@Injectable()
export class FmpClient implements FxQuote {
  private readonly logger = new Logger(FmpClient.name);
  private fmpClient?: AxiosInstance;
  private apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    const rawApiKey = this.configService.get<string>('FMP_API_KEY');
    this.apiKey = sanitizeApiKey(rawApiKey);

    if (!this.apiKey) {
      this.logger.warn('FMP api key is required.');
      return;
    }

    this.fmpClient = axios.create({
      baseURL: FMP_BASE_URL,
      method: 'get',
    });
  }

  private parseSymbols(symbols: Currencies | string): ParsedCurrencies {
    if (typeof symbols !== 'string') {
      return symbols;
    }

    const payload = symbols.trim();
    if (!payload) {
      throw new Error('Symbols payload is empty');
    }

    try {
      return JSON.parse(payload) as ParsedCurrencies;
    } catch {
      const repaired = payload
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');

      return JSON.parse(repaired) as ParsedCurrencies;
    }
  }

  private formatPairSymbol({ base, quote }: ParsedCurrencies): string {
    return `${base}${quote}`.toUpperCase();
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private extractPrice(data: unknown, symbol: string): number {
    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Invalid FMP response for ${symbol}`);
    }

    const quote = payload as FmpQuoteResponse;
    const price = this.toNumber(quote.price);
    if (price === undefined) {
      throw new Error(`Price not found in FMP response for ${symbol}`);
    }

    return price;
  }

  private requireClient(): AxiosInstance {
    if (!this.fmpClient || !this.apiKey) {
      throw new Error('fmp client is not initialized');
    }
    return this.fmpClient;
  }

  async fxRate(symbols: Currencies | string): Promise<{ price: number }> {
    const client = this.requireClient();
    const { base, quote } = this.parseSymbols(symbols);
    if (!base || !quote) {
      throw new Error('Both base and quote currencies are required');
    }

    const symbol = this.formatPairSymbol({ base, quote });

    try {
      const { data } = await client<unknown>({
        url: '/quote-short',
        params: {
          symbol,
          apikey: this.apiKey,
        },
      });

      const price = this.extractPrice(data, symbol);
      return { price };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.error(
          `FMP returned 401 for ${symbol}. Verify FMP_API_KEY.`,
        );
      }
      this.logger.error(`Failed to fetch fx rate for ${symbol}`, error);
      throw error;
    }
  }
}
