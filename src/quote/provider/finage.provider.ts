import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currencies, FxQuote } from '../interface/quote.interface';
import axios, { AxiosInstance } from 'axios';

type ParsedCurrencies = {
  base: string;
  quote: string;
};

@Injectable()
export class FinageClient implements FxQuote {
  private readonly logger = new Logger(FinageClient.name);
  private finageClient?: AxiosInstance;
  private apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    const rawApiKey = this.configService.get<string>('FINAGE_API_KEY');
    this.apiKey = this.sanitizeApiKey(rawApiKey);

    if (!this.apiKey) {
      this.logger.warn('Finage api key is required.');
      return;
    }

    this.finageClient = axios.create({
      baseURL: 'https://api.finage.co.uk',
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
      // Accept JavaScript-literal payloads like `{ base: "JPY", quote: "EUR" }`.
      const repaired = payload
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');

      return JSON.parse(repaired) as ParsedCurrencies;
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

  private extractPrice(data: unknown, symbol: string): number {
    const payload: unknown = Array.isArray(data) ? data[0] : data;
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Invalid Finage response for ${symbol}`);
    }

    const quote = payload as Record<string, unknown>;
    const directCandidates = [
      quote.price,
      quote.last,
      quote.value,
      quote.mid,
      quote.result,
      quote.results,
    ];

    for (const candidate of directCandidates) {
      const price = this.toNumber(candidate);
      if (price !== undefined) {
        return price;
      }
    }

    const ask = this.toNumber(quote.ask);
    const bid = this.toNumber(quote.bid);
    if (ask !== undefined && bid !== undefined) {
      return (ask + bid) / 2;
    }
    if (ask !== undefined) {
      return ask;
    }
    if (bid !== undefined) {
      return bid;
    }

    throw new Error(`Price not found in Finage response for ${symbol}`);
  }

  async fxRate(symbols: Currencies | string): Promise<{ price: number }> {
    if (!this.finageClient || !this.apiKey) {
      throw new Error('finage client is not initialized');
    }

    const { base, quote } = this.parseSymbols(symbols);
    if (!base || !quote) {
      throw new Error('Both base and quote currencies are required');
    }

    const pair = `${quote}${base}`.toUpperCase();

    try {
      const { data } = await this.finageClient<unknown>({
        url: `/last/forex/${pair}`,
        params: { apikey: this.apiKey },
      });

      const price = this.extractPrice(data, pair);
      return { price };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.logger.error(
          `Finage returned 401 for ${pair}. Verify FINAGE_API_KEY and endpoint permissions.`,
        );
      }
      this.logger.error(`Failed to fetch fx rate for ${pair}`, error);
      throw error;
    }
  }
}
