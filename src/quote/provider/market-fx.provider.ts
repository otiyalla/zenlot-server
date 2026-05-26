import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  Currencies,
  FxMarketQuote,
  FxMarketQuoteSnapshot,
  FxQuote,
} from '../interface/quote.interface';

const MARKET_FX_BASE_URL = 'https://api.twelvedata.com';

type ParsedCurrencies = {
  base: string;
  quote: string;
};

type MarketFxErrorResponse = {
  code?: number;
  message?: string;
  status?: string;
};

type MarketFxPriceResponse = {
  price?: number | string;
} & MarketFxErrorResponse;

type MarketFxQuoteResponse = {
  symbol?: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  previous_close?: number | string;
  change?: number | string;
  percent_change?: number | string;
  is_market_open?: boolean;
} & MarketFxErrorResponse;

@Injectable()
export class MarketFxClient implements FxQuote, FxMarketQuote {
  private readonly logger = new Logger(MarketFxClient.name);
  private marketFxClient?: AxiosInstance;
  private apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    const rawApiKey = this.configService.get<string>('TWELVEDATA_API_KEY');
    this.apiKey = this.sanitizeApiKey(rawApiKey);

    if (!this.apiKey) {
      this.logger.warn('Market FX api key is required.');
      return;
    }

    this.marketFxClient = axios.create({
      baseURL: MARKET_FX_BASE_URL,
      method: 'get',
    });
  }

  private sanitizeApiKey(rawApiKey?: string): string | undefined {
    if (!rawApiKey) {
      return undefined;
    }

    const sanitized = rawApiKey
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/;+\s*$/g, '')
      .trim();

    return sanitized || undefined;
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
    return `${base}/${quote}`.toUpperCase();
  }

  private assertApiSuccess(data: unknown, symbol: string): void {
    if (!data || typeof data !== 'object') {
      throw new Error(`Invalid market FX response for ${symbol}`);
    }

    const payload = data as MarketFxErrorResponse;
    if (payload.status === 'error' || payload.code !== undefined) {
      throw new Error(
        payload.message ?? `Market FX request failed for ${symbol}`,
      );
    }
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

  private requireClient(): AxiosInstance {
    if (!this.marketFxClient || !this.apiKey) {
      throw new Error('market fx client is not initialized');
    }
    return this.marketFxClient;
  }

  async fxRate(symbols: Currencies | string): Promise<{ price: number }> {
    const client = this.requireClient();
    const { base, quote } = this.parseSymbols(symbols);
    if (!base || !quote) {
      throw new Error('Both base and quote currencies are required');
    }

    const symbol = this.formatPairSymbol({ base, quote });

    try {
      const { data } = await client<MarketFxPriceResponse>({
        url: '/price',
        params: {
          symbol,
          apikey: this.apiKey,
        },
      });

      this.assertApiSuccess(data, symbol);

      const price = this.toNumber(data.price);
      if (price === undefined) {
        throw new Error(`Price not found in market FX response for ${symbol}`);
      }
      
      return { price };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.error(
          `Market FX returned 401 for ${symbol}. Verify TWELVEDATA_API_KEY.`,
        );
      }
      this.logger.error(`Failed to fetch fx rate for ${symbol}`, error);
      throw error;
    }
  }

  async getMarketQuote(
    symbols: Currencies | string,
  ): Promise<FxMarketQuoteSnapshot> {
    const client = this.requireClient();
    const { base, quote } = this.parseSymbols(symbols);
    if (!base || !quote) {
      throw new Error('Both base and quote currencies are required');
    }

    const pairSymbol = this.formatPairSymbol({ base, quote });

    try {
      const { data } = await client<MarketFxQuoteResponse>({
        url: '/quote',
        params: {
          symbol: pairSymbol,
          apikey: this.apiKey,
        },
      });

      this.assertApiSuccess(data, pairSymbol);

      const close = this.toNumber(data.close);
      const snapshot: FxMarketQuoteSnapshot = {
        symbol: data.symbol ?? pairSymbol,
        name: data.name,
        exchange: data.exchange,
        currency: data.currency,
        datetime: data.datetime,
        timestamp: data.timestamp,
        price: close,
        open: this.toNumber(data.open),
        high: this.toNumber(data.high),
        low: this.toNumber(data.low),
        close,
        volume: this.toNumber(data.volume),
        previousClose: this.toNumber(data.previous_close),
        change: this.toNumber(data.change),
        percentChange: this.toNumber(data.percent_change),
        isMarketOpen: data.is_market_open,
      };

      return snapshot;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.error(
          `Market FX returned 401 for ${pairSymbol}. Verify TWELVEDATA_API_KEY.`,
        );
      }
      this.logger.error(
        `Failed to fetch market quote for ${pairSymbol}`,
        error,
      );
      throw error;
    }
  }
}
