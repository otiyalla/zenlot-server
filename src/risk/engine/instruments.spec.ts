import {
  CONTRACT_SIZE,
  getContractSize,
  getInstrumentType,
  getLotStep,
  getPipSize,
  getValuePerLot,
} from './instruments';

describe('getInstrumentType', () => {
  it('detects metals, crypto, and energy by symbol token', () => {
    expect(getInstrumentType('XAUUSD')).toBe('gold');
    expect(getInstrumentType('XAGUSD')).toBe('silver');
    expect(getInstrumentType('BTCUSD')).toBe('bitcoin');
    expect(getInstrumentType('ETHUSD')).toBe('ethereum');
    expect(getInstrumentType('WTIUSD')).toBe('oil');
  });

  it('defaults to forex for currency pairs', () => {
    expect(getInstrumentType('EURUSD')).toBe('forex');
    expect(getInstrumentType('GBPJPY')).toBe('forex');
  });

  it('is case-insensitive', () => {
    expect(getInstrumentType('btcusd')).toBe('bitcoin');
  });
});

describe('getContractSize', () => {
  it('maps each instrument to its contract size', () => {
    expect(getContractSize('EURUSD')).toBe(CONTRACT_SIZE.forex);
    expect(getContractSize('XAUUSD')).toBe(CONTRACT_SIZE.gold);
    expect(getContractSize('XAGUSD')).toBe(CONTRACT_SIZE.silver);
  });
});

describe('getPipSize', () => {
  it('uses 0.01 for JPY pairs, 0.0001 otherwise', () => {
    expect(getPipSize('USDJPY')).toBe(0.01);
    expect(getPipSize('GBPJPY')).toBe(0.01);
    expect(getPipSize('EURUSD')).toBe(0.0001);
  });
});

describe('getLotStep', () => {
  it('uses 0.01 for forex/metals/energy and 0.001 for crypto', () => {
    expect(getLotStep('EURUSD')).toBe(0.01);
    expect(getLotStep('XAUUSD')).toBe(0.01);
    expect(getLotStep('BTCUSD')).toBe(0.001);
    expect(getLotStep('ETHUSD')).toBe(0.001);
  });
});

describe('getValuePerLot', () => {
  it('multiplies contract size by the quote→account exchange rate', () => {
    expect(getValuePerLot('EURUSD', 1)).toBe(100000);
    expect(getValuePerLot('XAUUSD', 1)).toBe(100);
    expect(getValuePerLot('EURGBP', 1.27)).toBeCloseTo(127000, 6);
  });
});
