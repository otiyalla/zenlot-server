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

export const FX_QUOTE = Symbol('FX_QUOTE');
