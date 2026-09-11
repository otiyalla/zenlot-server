import { Module } from '@nestjs/common';
import { PriceFeedService } from './price-feed.service';
import { PriceFeedGateway } from './price-feed.gateway';
import { PriceFeedProcessor } from './price-feed.processor';
import { BullModule } from '@nestjs/bullmq';
import { PriceFeedController } from './price-feed.controller';
import { AuthModule } from '../auth/auth.module';
import { QuoteModule } from '../quote/quote.module';
import { SocketSessionModule } from '../auth/socket-session.module';

@Module({
  imports: [
    AuthModule,
    QuoteModule,
    SocketSessionModule,
    BullModule.registerQueue({
      name: 'price-feed',
      // defaultJobOptions can be set here if needed
    }),
  ],
  providers: [PriceFeedService, PriceFeedGateway, PriceFeedProcessor],
  controllers: [PriceFeedController],
})
export class PriceFeedModule {}
