import { Module } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { QuoteGateway } from './quote.gateway';

@Module({
  providers: [QuoteGateway, QuoteService],
})
export class QuoteModule {}
