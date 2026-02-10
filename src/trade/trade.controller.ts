import {
  Query,
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
} from '@nestjs/common';
import { TradeService } from './trade.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { DateRangeDto } from './dto/date-range.dto';
import { SymbolDateRangeDto } from './dto/symbol-date-range.dto';
import { MultiTradeDto } from './dto/multiple-properties.dto';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Trade')
@ApiSecurity('access-token')
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
    type: CreateTradeDto,
  })
  async create(@Body() createTradeDto: CreateTradeDto) {
    return this.tradeService.create(createTradeDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all trades for a user' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findAll(@Query() query: { userId: string }) {
    return this.tradeService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade fetched successfully.' })
  async findOne(@Param('id') id: string) {
    console.log('Finding trade with id: ', id);
    return this.tradeService.findOne(id);
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
  @ApiOperation({ summary: 'Get trades by date range' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiQuery({
    name: 'start',
    required: true,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'end',
    required: true,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findByDateRange(@Query() dto: DateRangeDto) {
    console.log('the data: ', dto);
    return this.tradeService.findByDateRange(dto);
  }

  //http://localhost:3000/trade/range?start=2025-07-01&end=2025-07-12&symbol=EURUSD
  @Get('symbol/range')
  @ApiOperation({ summary: 'Get trades by symbol and date range' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiQuery({
    name: 'symbol',
    required: true,
    description: 'Instrument symbol',
  })
  @ApiQuery({
    name: 'start',
    required: true,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'end',
    required: true,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findSymbolByDateRange(@Query() dto: SymbolDateRangeDto) {
    console.log('symbol date range dto: ', dto);
    return this.tradeService.findByDateRangeBySymbol(dto);
  }

  @Get('symbol')
  @ApiOperation({ summary: 'Get trades by symbol' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiQuery({
    name: 'symbol',
    required: true,
    description: 'Instrument symbol',
  })
  @ApiQuery({
    name: 'start',
    required: true,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'end',
    required: true,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findSymbol(@Query() dto: SymbolDateRangeDto) {
    return this.tradeService.findBySymbol(dto);
  }

  @Get('symbols')
  @ApiOperation({ summary: 'Get trades by multiple symbols' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiQuery({
    name: 'symbols',
    required: true,
    isArray: true,
    description: 'Instrument symbols',
  })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findSymbols(@Query() dto: { symbols: string[]; userId: string }) {
    return this.tradeService.findByMultipleSymbols(dto);
  }

  @Get('filter')
  @ApiOperation({ summary: 'Filter trades by multiple properties' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiQuery({
    name: 'symbol',
    required: false,
    description: 'Instrument symbol',
  })
  @ApiQuery({ name: 'lot', required: false, description: 'Trade lot size' })
  @ApiQuery({ name: 'pips', required: false, description: 'Trade pips value' })
  @ApiQuery({
    name: 'execution',
    required: false,
    description: 'Execution type (buy/sell)',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Trade status' })
  @ApiQuery({
    name: 'start',
    required: false,
    description: 'Start date (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    description: 'End date (YYYY-MM-DD)',
  })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async filterTrade(@Query() dto: MultiTradeDto) {
    return this.tradeService.findByMultipleProperties(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade updated successfully.' })
  async update(
    @Param('id') id: string,
    @Body() updateTradeDto: UpdateTradeDto,
  ) {
    return this.tradeService.update(id, updateTradeDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade deleted successfully.' })
  async remove(@Param('id') id: string) {
    return this.tradeService.remove(id);
  }
}
