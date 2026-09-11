/**
 * Instrument metadata for the risk engine.
 *
 * CONTRACT_SIZE and instrument detection are ported from the frontend
 * (`constants/trade.ts`) so server-side sizing matches the client's money math.
 * Position-sizing dollars are computed from `priceDistance × contractSize ×
 * exchangeRate` (see calculations.ts), which generalises the spec's forex-only
 * pip model to every instrument the app supports.
 */

/** Smallest lot increment the engine will round down to. */
export const MIN_LOT_SIZE = 0.001;

/**
 * Units of the base instrument per 1.00 standard lot, by instrument class.
 * Mirrors the frontend map. Used as the price→money multiplier per lot.
 */
export const CONTRACT_SIZE = {
  forex: 100000, // standard lot
  gold: 100,
  silver: 5000,
  copper: 25000,
  palladium: 50,
  platinum: 100,
  oil: 1000,
  gas: 1000,
  bitcoin: 0.0001,
  ethereum: 0.0001,
  litecoin: 0.0001,
  ripple: 0.0001,
} as const;

export type InstrumentType = keyof typeof CONTRACT_SIZE;

/** Symbol fragments that identify a non-forex instrument. Anything else is forex. */
const INSTRUMENT_TOKENS: Record<Exclude<InstrumentType, 'forex'>, string[]> = {
  gold: ['XAU'],
  silver: ['XAG'],
  copper: ['XCU'],
  palladium: ['XPD'],
  platinum: ['XPT'],
  oil: ['WTI'],
  gas: ['UGA'],
  bitcoin: ['BTC'],
  ethereum: ['ETH'],
  litecoin: ['LTC'],
  ripple: ['XRP'],
};

/**
 * Lot rounding step per instrument. Spec uses 0.01 micro-lots for forex; we
 * default every instrument to 0.01.
 *
 * Forex, metals, and energy round to 0.01 (micro-lot); crypto rounds to the
 * finer 0.001 increment. The hard floor across all instruments is
 * MIN_LOT_SIZE (0.001) — a position smaller than that is treated as untradeable.
 */
const LOT_STEP: Partial<Record<InstrumentType, number>> = {
  bitcoin: 0.001,
  ethereum: 0.001,
  litecoin: 0.001,
  ripple: 0.001,
};
const DEFAULT_LOT_STEP = 0.01;

export function getInstrumentType(symbol: string): InstrumentType {
  const upper = symbol.toUpperCase();
  const match = (
    Object.keys(INSTRUMENT_TOKENS) as Exclude<InstrumentType, 'forex'>[]
  ).find((key) =>
    INSTRUMENT_TOKENS[key].some((token) => upper.includes(token)),
  );
  return match ?? 'forex';
}

export function getContractSize(symbol: string): number {
  return CONTRACT_SIZE[getInstrumentType(symbol)];
}

export function getLotStep(symbol: string): number {
  return LOT_STEP[getInstrumentType(symbol)] ?? DEFAULT_LOT_STEP;
}

/**
 * Pip size for a pair. JPY pairs → 0.01, otherwise 0.0001 (spec Section 13.1).
 * Note: capital-exposure math does NOT depend on pip size — it uses the raw
 * price distance — so pip size only affects the `stopDistancePips`/`pipValue`
 * figures surfaced for display. For non-forex instruments these are nominal.
 */
export function getPipSize(pair: string): number {
  // Any JPY pair (USDJPY, EURJPY, …) quotes to two decimals → pip 0.01.
  return pair.toUpperCase().includes('JPY') ? 0.01 : 0.0001;
}

/**
 * Value of one full unit of price movement, per standard lot, in the account
 * currency. `exchangeRate` is the quote-currency → account-currency rate
 * (1.0 when the quote currency already is the account currency).
 */
export function getValuePerLot(symbol: string, exchangeRate: number): number {
  return getContractSize(symbol) * exchangeRate;
}
