import {
  Query,
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TradeService } from './trade.service';
import { TradeLogService } from '../risk/trade-log.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { DateRangeDto } from './dto/date-range.dto';
import { SymbolDateRangeDto } from './dto/symbol-date-range.dto';
import { MultiTradeDto } from './dto/multiple-properties.dto';
import { MultipleSymbolsDto } from './dto/multiple-symbols.dto';
import { TradeOwnerDto } from './dto/trade-owner.dto';
import { SearchTradeDto } from './dto/search-trade.dto';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';
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
  constructor(
    private readonly tradeService: TradeService,
    private readonly tradeLogService: TradeLogService,
  ) {}

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
  async create(
    @Body() createTradeDto: CreateTradeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    // Keep the legacy route available, but send it through the same server-side
    // sizing and governance path as POST /risk/trades.  The legacy DTO contains
    // persisted/calculated fields (lot, pips, risk, reward, exchange rate and
    // status) that must never be trusted from the client.
    return this.tradeLogService.logTrade(
      req.user.id,
      req.user.accountCurrency,
      {
        symbol: createTradeDto.symbol,
        execution: createTradeDto.execution as 'buy' | 'sell',
        entry: createTradeDto.entry,
        stopPrice: createTradeDto.stopLoss?.value,
        targetPrice: createTradeDto.takeProfit?.value,
        lot: createTradeDto.lot,
        plainText: createTradeDto.plainText,
        editorState: createTradeDto.editorState,
      },
      req.user.language,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get all trades for a user' })
  @ApiQuery({ name: 'userId', required: true, description: 'Trade owner id' })
  @ApiResponse({ status: 200, description: 'Trades fetched successfully.' })
  async findAll(
    @Query() query: TradeOwnerDto,
    @Request() req: AuthenticatedRequest,
  ) {
    query.userId = req.user.id;
    return this.tradeService.findAll(query);
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
  async findByDateRange(
    @Query() dto: DateRangeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
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
  async findSymbolByDateRange(
    @Query() dto: SymbolDateRangeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
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
  async findSymbol(
    @Query() dto: SymbolDateRangeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
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
  async findSymbols(
    @Query() dto: MultipleSymbolsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
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
  async filterTrade(
    @Query() dto: MultiTradeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
    return this.tradeService.findByMultipleProperties(dto);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search trades' })
  @ApiQuery({ name: 'userId', required: false, description: 'Trade owner id' })
  @ApiQuery({ name: 'query', required: false, description: 'Text query' })
  @ApiQuery({
    name: 'queryTerms',
    required: false,
    isArray: true,
    description: 'Additional text terms to search',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description: 'Single trade status',
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    isArray: true,
    description: 'Multiple trade statuses',
  })
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
  async search(
    @Query() dto: SearchTradeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    dto.userId = req.user.id;
    return this.tradeService.search(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade fetched successfully.' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.tradeService.findOneForUser(id, req.user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade updated successfully.' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTradeDto: UpdateTradeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.tradeService.updateForUser(id, req.user.id, updateTradeDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a trade by id' })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade deleted successfully.' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    // Delegates to the risk module so a delete reverses any settled realized PnL
    // (keeping the circuit breaker correct). Response shape `{ deleted: true }`
    // is preserved.
    return this.tradeLogService.deleteTrade(req.user.id, id);
  }
}
