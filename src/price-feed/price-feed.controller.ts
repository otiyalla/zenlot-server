import { Controller } from '@nestjs/common';
import { PriceFeedService } from './price-feed.service';
import { Get } from '@nestjs/common';
import { Query } from '@nestjs/common';

@Controller('pricefeed')
export class PriceFeedController {
    constructor(private readonly priceFeedService: PriceFeedService) {}

    @Get()
    async getPriceFeed(@Query() symbol: string) {
        console.log('PriceFeedController: getPriceFeed called with symbol:', symbol);
        return this.priceFeedService.addPriceFeedJob(symbol);
    }
}
