import { Logger, Module } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { QuoteGateway } from './quote.gateway';
import { AuthModule } from '../auth/auth.module';
import { UniRateClient } from './provider/unirate.provider';
import { FinageClient } from './provider/finage.provider';
import { Currencies, FX_QUOTE, FxQuote } from './interface/quote.interface';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [AuthModule],
  providers: [
    UniRateClient,
    FinageClient,
    {
      provide: FX_QUOTE,
      inject: [ConfigService, UniRateClient, FinageClient],
      useFactory: (
        configService: ConfigService,
        uniRateClient: UniRateClient,
        finageClient: FinageClient,
      ): FxQuote => {
        const hasUniRate = !!configService.get<string>('UNIRATE_API_KEY');
        const hasFinage = !!configService.get<string>('FINAGE_API_KEY');
        const logger = new Logger('FxQuoteProvider');

        return {
          async fxRate(symbols: Currencies) {
            if (hasUniRate) {
              try {
                return await uniRateClient.fxRate(symbols);
              } catch (error) {
                if (!hasFinage) {
                  throw error;
                }

                logger.warn(
                  'UniRate failed. Falling back to Finage for fx quote.',
                );
              }
            }

            if (hasFinage) {
              try {
                return finageClient.fxRate(symbols);
              } catch (error) {
                logger.warn('Finage error: ', error);
                throw error;
              }
            }

            throw new Error(
              'No fx quote provider configured. Set UNIRATE_API_KEY or FINAGE_API_KEY.',
            );
          },
        };
      },
    },
    QuoteGateway,
    QuoteService,
  ],
  exports: [QuoteService],
})
export class QuoteModule {}
