import { Module } from '@nestjs/common';
import { CandleController } from './candle.controller';
import { CandleService } from './candle.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TwelveDataCandleProvider } from './provider/twelvedata-candle.provider';
import { OandaCandleProvider } from './provider/oanda-candle.provider';
import { MassiveCandleProvider } from './provider/massive-candle.provider';
import { CANDLE_PROVIDERS, CandleProvider } from './interface/candle.interface';
import { CandleLiveService } from './candle-live.service';
import { CandleGateway } from './candle.gateway';
import { ProviderBudgetModule } from './util/provider-budget.module';
import { SocketSessionModule } from '../auth/socket-session.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ProviderBudgetModule,
    SocketSessionModule,
  ],
  controllers: [CandleController],
  providers: [
    TwelveDataCandleProvider,
    OandaCandleProvider,
    MassiveCandleProvider,
    {
      // Ordered fallback chain: Massive (primary) -> TwelveData -> OANDA.
      provide: CANDLE_PROVIDERS,
      inject: [
        TwelveDataCandleProvider,
        OandaCandleProvider,
        MassiveCandleProvider,
      ],
      useFactory: (
        twelveData: TwelveDataCandleProvider,
        oanda: OandaCandleProvider,
        massive: MassiveCandleProvider,
      ): CandleProvider[] => [massive, twelveData, oanda],
    },
    CandleService,
    CandleLiveService,
    CandleGateway,
  ],
  exports: [CandleService],
})
export class CandleModule {}
