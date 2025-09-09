import { Query, Controller, Get, Post, Body, Put, Param, Delete } from '@nestjs/common';
import { TradeService } from './trade.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { DateRangeDto } from './dto/date-range.dto';
import { SymbolDateRangeDto } from './dto/symbol-date-range.dto';
import { MultiTradeDto } from './dto/multiple-properties.dto';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

@ApiTags('Trade')
@ApiSecurity('access_token')
@Controller('trade')
export class TradeController {
  constructor(private readonly tradeService: TradeService) {}

  /**
   * @swagger
   * tags:
   *   name: Trade
   *   description: Trade management
   */

  @Post()
  @ApiOperation({ summary: 'Create a new trade entry' })
  @ApiResponse({ 
    status: 201, 
    description: 'The trade has been created.',
    type: CreateTradeDto
   })
  async create(@Body() createTradeDto: CreateTradeDto) {
    return this.tradeService.create(createTradeDto);
  }

  @Get()
  async findAll(@Query() query: { userId: number}) {
    return this.tradeService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    console.log("Finding trade with id: ", id);
    return this.tradeService.findOne(+id);
  }

  //http://localhost:3000/trade/range?start=2025-07-01&end=2025-07-12
  /**
   * @swagger
   * /trade/range:
   *   get:
   *     summary: Get trades by date range
   *     tags: [Trade]
   *     parameters:
   *       - in: query
   *         name: start
   *         required: true
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: end
   *         required: true
   *         schema:
   *           type: string
   *           format: date-time
   */
  @Get('range')
  async findByDateRange(@Query() dto: DateRangeDto) {
    console.log("the data: ", dto);
    return this.tradeService.findByDateRange(dto);
  }

  //http://localhost:3000/trade/range?start=2025-07-01&end=2025-07-12&symbol=EURUSD
  @Get('symbol/range')
  async findSymbolByDateRange(@Query() dto: SymbolDateRangeDto) {
    console.log("symbol date range dto: ", dto);
    return this.tradeService.findByDateRangeBySymbol(dto);
  }

 @Get('symbol')
  async findSymbol(@Query() dto: SymbolDateRangeDto) {  
    return this.tradeService.findBySymbol(dto);
  }

 @Get('symbols')
  async findSymbols(@Query() dto: {symbols: string[], userId: number}) {  
    return this.tradeService.findByMultipleSymbols(dto);
  }

  @Get('filter')
  async filterTrade(@Query() dto: MultiTradeDto) {  
    return this.tradeService.findByMultipleProperties(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateTradeDto: UpdateTradeDto) {
    return this.tradeService.update(+id, updateTradeDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: number) {
    return this.tradeService.remove(+id);
  }
}
