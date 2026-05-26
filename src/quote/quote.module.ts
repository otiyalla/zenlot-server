import { Logger, Module } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { QuoteGateway } from './quote.gateway';
import { AuthModule } from '../auth/auth.module';
import { UniRateClient } from './provider/unirate.provider';
import { MarketFxClient } from './provider/market-fx.provider';
import {
  Currencies,
  FX_MARKET_QUOTE,
  FX_QUOTE,
  FxMarketQuote,
  FxQuote,
} from './interface/quote.interface';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [AuthModule],
  providers: [
    UniRateClient,
    MarketFxClient,
    {
      provide: FX_QUOTE,
      inject: [ConfigService, MarketFxClient, UniRateClient],
      useFactory: (
        configService: ConfigService,
        marketFxClient: MarketFxClient,
        uniRateClient: UniRateClient,
      ): FxQuote => {
        const hasMarketFx = !!configService.get<string>('TWELVEDATA_API_KEY');
        const hasUniRate = !!configService.get<string>('UNIRATE_API_KEY');
        const logger = new Logger('FxQuoteProvider');

        return {
          async fxRate(symbols: Currencies) {
            if (hasMarketFx) {
              try {
                return await marketFxClient.fxRate(symbols);
              } catch (error) {
                if (!hasUniRate) {
                  throw error;
                }

                logger.warn(
                  'Market FX failed. Falling back to UniRate for fx quote.',
                );
              }
            }

            if (hasUniRate) {
              return uniRateClient.fxRate(symbols);
            }

            throw new Error(
              'No fx quote provider configured. Set TWELVEDATA_API_KEY or UNIRATE_API_KEY.',
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
