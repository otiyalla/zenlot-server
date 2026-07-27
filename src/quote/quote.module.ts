import { Logger, Module } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { QuoteGateway } from './quote.gateway';
import { AuthModule } from '../auth/auth.module';
import { UniRateClient } from './provider/unirate.provider';
import { MarketFxClient } from './provider/market-fx.provider';
import { FmpClient } from './provider/fmp.provider';
import {
  Currencies,
  FX_MARKET_QUOTE,
  FX_QUOTE,
  FxMarketQuote,
  FxQuote,
} from './interface/quote.interface';
import { ConfigService } from '@nestjs/config';
import { ProviderBudgetModule } from '../candle/util/provider-budget.module';

@Module({
  imports: [AuthModule, ProviderBudgetModule],
  providers: [
    UniRateClient,
    MarketFxClient,
    FmpClient,
    {
      provide: FX_QUOTE,
      inject: [ConfigService, MarketFxClient, FmpClient, UniRateClient],
      useFactory: (
        configService: ConfigService,
        marketFxClient: MarketFxClient,
        fmpClient: FmpClient,
        uniRateClient: UniRateClient,
      ): FxQuote => {
        const hasMarketFx = !!configService.get<string>('TWELVEDATA_API_KEY');
        const hasFmp = !!configService.get<string>('FMP_API_KEY');
        const hasUniRate = !!configService.get<string>('UNIRATE_API_KEY');
        const logger = new Logger('FxQuoteProvider');

        return {
          async fxRate(symbols: Currencies) {
            if (hasMarketFx) {
              try {
                return await marketFxClient.fxRate(symbols);
              } catch (error) {
                if (!hasFmp && !hasUniRate) {
                  throw error;
                }

                logger.warn(
                  'Market FX failed. Falling back to next fx quote provider.',
                );
              }
            }

            if (hasFmp) {
              try {
                return await fmpClient.fxRate(symbols);
              } catch (error) {
                if (!hasUniRate) {
                  throw error;
                }

                logger.warn(
                  'FMP failed. Falling back to UniRate for fx quote.',
                );
              }
            }

            if (hasUniRate) {
              return uniRateClient.fxRate(symbols);
            }

            throw new Error(
              'No fx quote provider configured. Set TWELVEDATA_API_KEY, FMP_API_KEY, or UNIRATE_API_KEY.',
            );
          },
        };
      },
    },
    {
      provide: FX_MARKET_QUOTE,
      inject: [ConfigService, MarketFxClient],
      useFactory: (
        configService: ConfigService,
        marketFxClient: MarketFxClient,
      ): FxMarketQuote => {
        const hasMarketFx = !!configService.get<string>('TWELVEDATA_API_KEY');

        if (hasMarketFx) {
          return marketFxClient;
        }

        return {
          getMarketQuote() {
            throw new Error(
              'Market quote provider is not configured. Set TWELVEDATA_API_KEY.',
            );
          },
        };
      },
    },
    QuoteGateway,
    QuoteService,
  ],
  exports: [QuoteService, QuoteGateway],
})
export class QuoteModule {}
