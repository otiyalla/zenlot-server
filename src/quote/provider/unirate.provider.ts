import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currencies, FxQuote } from '../interface/quote.interface';
import axios, { AxiosInstance } from 'axios';

type UniRateConvertResponse = {
  result: number | string;
};

type ParsedCurrencies = {
  base: string;
  quote: string;
};

@Injectable()
export class UniRateClient implements FxQuote {
  private readonly logger = new Logger(UniRateClient.name);
  private uniRateClient?: AxiosInstance;
  private apiKey?: string;

  constructor(private readonly configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient(): void {
    this.apiKey = this.configService.get<string>('UNIRATE_API_KEY');

    if (!this.apiKey) {
      this.logger.warn('UniRate api key is required.');
      return;
    }

    this.uniRateClient = axios.create({
      baseURL: 'https://api.unirateapi.com/api/convert',
      method: 'get',
      timeout: 8000,
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
      // Accept JavaScript-literal payloads like `{ base: "JPY", quote: "EUR" }`.
      const repaired = payload
        .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');

      return JSON.parse(repaired) as ParsedCurrencies;
    }
  }

  async fxRate(symbols: Currencies | string): Promise<{ price: number }> {
    if (!this.uniRateClient || !this.apiKey) {
      throw new Error('unirate client is not initialized');
    }
    const { base, quote } = this.parseSymbols(symbols);
    if (!base || !quote) {
      throw new Error('Both base and quote currencies are required');
    }

    try {
      const { data } = await this.uniRateClient<UniRateConvertResponse>({
        params: {
          api_key: this.apiKey,
          amount: 1,
          from: base.toUpperCase(),
          to: quote.toUpperCase(),
        },
      });

      const rawPrice = data?.result;
      const price =
        typeof rawPrice === 'number' ? rawPrice : Number.parseFloat(rawPrice);
      if (!Number.isFinite(price)) {
        throw new Error(`Invalid UniRate response for ${base}/${quote}`);
      }

      return { price };
    } catch (error) {
      this.logger.error(`Failed to fetch fx rate for ${base}/${quote}`, error);
      throw error;
    }
  }
}
