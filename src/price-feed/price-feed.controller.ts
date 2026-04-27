import { Query, Controller, Get } from '@nestjs/common';
import { PriceFeedService } from './price-feed.service';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('PriceFeed')
@ApiSecurity('access-token')
@Controller('pricefeed')
export class PriceFeedController {
  constructor(private readonly priceFeedService: PriceFeedService) {}

  @Get()
  @ApiOperation({ summary: 'Get price feed by symbol' })
  @ApiQuery({
    name: 'symbol',
    required: true,
    description: 'Instrument symbol',
  })
  @ApiResponse({
    status: 200,
    description: 'Price feed job queued successfully.',
  })
  async getPriceFeed(@Query() symbol: string) {
    console.log(
      'PriceFeedController: getPriceFeed called with symbol:',
      symbol,
    );
    return this.priceFeedService.addPriceFeedJob(symbol);
  }

  @Get('exchangeRate')
  @ApiOperation({ summary: 'Get exchange rate for a symbol' })
  @ApiParam({
    name: 'symbol',
    required: true,
    description: 'Instrument symbol',
  })
  @ApiResponse({
    status: 200,
    description: 'Exchange rate fetched successfully.',
  })
  async getFX(@Query('base') base: string, @Query('quote') quote: string) {
    return this.priceFeedService.getFX({ base, quote });
  }
}
