import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CandleService } from './candle.service';
import { CandleQueryDto } from './dto/candle-query.dto';

@ApiTags('Candle')
@ApiSecurity('access-token')
@Controller('candle')
export class CandleController {
  constructor(private readonly candleService: CandleService) {}

  @Get()
  @ApiOperation({
    summary: 'Get OHLC candles for a forex pair (read-through cache)',
  })
  @ApiResponse({ status: 200, description: 'Candle series returned.' })
  async getCandles(@Query() query: CandleQueryDto) {
    return this.candleService.getCandles({
      symbol: query.symbol,
      timeframe: query.timeframe,
      from: query.from,
      to: query.to,
    });
  }
}
