import { Module } from '@nestjs/common';
import { PriceFeedService } from './price-feed.service';
import { PriceFeedGateway } from './price-feed.gateway';
import { PriceFeedProcessor } from './price-feed.processor';
import { BullModule } from '@nestjs/bullmq';  
import { PriceFeedController } from './price-feed.controller';
import { QuoteGateway } from 'src/quote/quote.gateway';
import { QuoteService } from 'src/quote/quote.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'price-feed',
      // defaultJobOptions can be set here if needed
    }),
  ],
  providers: [QuoteService, QuoteGateway, PriceFeedService, PriceFeedGateway, PriceFeedProcessor],
  controllers: [PriceFeedController],
})
export class PriceFeedModule {}
