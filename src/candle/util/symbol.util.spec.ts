import {
  normalizePair,
  parsePair,
  toOandaInstrument,
  toMassiveTicker,
  toTwelveDataSymbol,
} from './symbol.util';

describe('symbol util', () => {
  it('normalizes mixed separators/case to the canonical 6-char form', () => {
    expect(normalizePair('eur/usd')).toBe('EURUSD');
    expect(normalizePair('EUR_USD')).toBe('EURUSD');
    expect(normalizePair('eurusd')).toBe('EURUSD');
  });

  it('rejects non 6-letter symbols', () => {
    expect(() => normalizePair('BTCUSDT')).toThrow();
    expect(() => normalizePair('EUR')).toThrow();
  });

  it('parses base/quote', () => {
    expect(parsePair('EURUSD')).toEqual({ base: 'EUR', quote: 'USD' });
  });

  it('formats per provider', () => {
    expect(toTwelveDataSymbol('EURUSD')).toBe('EUR/USD');
    expect(toOandaInstrument('EURUSD')).toBe('EUR_USD');
    expect(toMassiveTicker('EURUSD')).toBe('C:EURUSD');
  });
});
