import { Module } from '@nestjs/common';
import { CandleController } from './candle.controller';
import { CandleService } from './candle.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TwelveDataCandleProvider } from './provider/twelvedata-candle.provider';
import { OandaCandleProvider } from './provider/oanda-candle.provider';
import { PolygonCandleProvider } from './provider/polygon-candle.provider';
import { CANDLE_PROVIDERS, CandleProvider } from './interface/candle.interface';
import { CandleLiveService } from './candle-live.service';
import { CandleGateway } from './candle.gateway';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CandleController],
  providers: [
    TwelveDataCandleProvider,
    OandaCandleProvider,
    PolygonCandleProvider,
    {
      // Ordered fallback chain: TwelveData (primary) -> OANDA -> Polygon.
      provide: CANDLE_PROVIDERS,
      inject: [
        TwelveDataCandleProvider,
        OandaCandleProvider,
        PolygonCandleProvider,
      ],
      useFactory: (
        twelveData: TwelveDataCandleProvider,
        oanda: OandaCandleProvider,
        polygon: PolygonCandleProvider,
      ): CandleProvider[] => [twelveData, oanda, polygon],
    },
    CandleService,
    CandleLiveService,
    CandleGateway,
  ],
  exports: [CandleService],
})
export class CandleModule {}
