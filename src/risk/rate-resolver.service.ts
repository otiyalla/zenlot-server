import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { QuoteService } from '../quote/quote.service';

/**
 * Resolves the quote-currency → account-currency exchange rate used by the
 * risk engine's money math. Mirrors the app's existing convention:
 * fxRate({ base: quoteCurrency, quote: accountCurrency }) — i.e. how many units
 * of the account currency one unit of the pair's quote currency is worth.
 */
@Injectable()
export class RateResolverService {
  private readonly logger = new Logger(RateResolverService.name);

  constructor(private readonly quoteService: QuoteService) {}

  /**
   * Returns the quote→account rate (1.0 when the quote currency already is the
   * account currency). Falls back to the inverse pair, then throws so the caller
   * can surface a clear retry message rather than sizing a trade on a wrong rate
   * (spec §11.1).
   */
  async resolveExchangeRate(
    symbol: string,
    accountCurrency: string,
  ): Promise<number> {
    const quote = symbol.slice(3, 6).toUpperCase();
    const account = accountCurrency.toUpperCase();
    if (quote === account) return 1;

    try {
      const { price } = await this.quoteService.fxRate({
        base: quote,
        quote: account,
      });
      if (price > 0) return price;
    } catch (error) {
      this.logger.warn(`fxRate ${quote}/${account} failed; trying inverse`);
      Sentry.captureException(error, {
        extra: { symbol, accountCurrency, context: 'resolveExchangeRate' },
      });
    }

    try {
      const { price } = await this.quoteService.fxRate({
        base: account,
        quote,
      });
      if (price > 0) return 1 / price;
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          symbol,
          accountCurrency,
          context: 'resolveExchangeRate.inverse',
        },
      });
    }

    throw new ServiceUnavailableException(
      'Live rate unavailable. Refresh to retry.',
    );
  }
}
