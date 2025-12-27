export class ListQuotesDto {
    symbol: string;
    name: string;
    currency: string;
    stockExchange: string;
    exchangeShortName: string;
}

export class fmpList {
    symbol: string;
    fromCurrency: string;
    toCurrency: string;
    fromName: string;
    toName: string
}

export class AvailableSymbols {
    symbol: string;
    currency: string;
}

export class Quote {
    symbol: string;
    name: string;
    price: number;
    open: number;
    dayLow: number;
    dayHigh: number;
}
