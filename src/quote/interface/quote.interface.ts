/**
 * @param {string} quote the currency to convert from
 * @param {string} base the currencry to conver to
 */
export type Currencies =
  | {
      quote: string;
      base: string;
    }
  | string;

export interface FxQuote {
  fxRate(symbols: Currencies): Promise<{ price: number }>;
  //listCurrencies(): Promise<{}>
}

export interface FxMarketQuoteSnapshot {
  symbol: string;
  name?: string;
  exchange?: string;
  currency?: string;
  datetime?: string;
  timestamp?: number;
  price?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  previousClose?: number;
  change?: number;
  percentChange?: number;
  isMarketOpen?: boolean;
}

export interface FxMarketQuote {
  getMarketQuote(symbols: Currencies): Promise<FxMarketQuoteSnapshot>;
}

export const FX_QUOTE = Symbol('FX_QUOTE');
export const FX_MARKET_QUOTE = Symbol('FX_MARKET_QUOTE');
