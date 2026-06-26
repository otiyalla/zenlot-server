import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TradeService } from './trade.service';
import { TradeController } from './trade.controller';
import { QuoteModule } from '../quote/quote.module';
import { RiskModule } from '../risk/risk.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradeAutoCloseProcessor } from './trade-auto-close.processor';
import {
  TRADE_AUTO_CLOSE_QUEUE,
  TradeAutoCloseService,
} from './trade-auto-close.service';

@Module({
  imports: [
    QuoteModule,
    RiskModule,
    NotificationsModule,
    BullModule.registerQueue({
      name: TRADE_AUTO_CLOSE_QUEUE,
    }),
  ],
  controllers: [TradeController],
  providers: [TradeService, TradeAutoCloseService, TradeAutoCloseProcessor],
})
export class TradeModule {}
