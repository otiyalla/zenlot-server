import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { DateRangeDto } from './dto/date-range.dto';
import { SymbolDateRangeDto } from './dto/symbol-date-range.dto';
import { parseInclusiveDateRangeEnd } from '../utils/date-range.util';
import { MultiTradeDto } from './dto/multiple-properties.dto';
import { SearchTradeDto } from './dto/search-trade.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, trade } from '../../prisma/generated/prisma/client';
import { RiskCalculationService } from '../risk/risk-calculation.service';
import { SETTLED_STATUSES, TradeLogService } from '../risk/trade-log.service';

/**
 * Fields whose change alters a trade's capital exposure or reward sizing, so a
 * change to any of them on an *open* trade requires the active risk figures
 * (`capitalExposure`/`capitalExposurePct`/`risk`/`reward`) to be recomputed
 * — otherwise the portfolio exposure snapshot keeps summing stale numbers.
 * The planned `rr` recorded when the trade was sized is intentionally excluded:
 * later stop management must not rewrite that grading baseline.
 */
const RISK_AFFECTING_FIELDS = [
  'entry',
  'stopLoss',
  'takeProfit',
  'lot',
  'execution',
  'symbol',
] as const;

const GEOMETRY_AFFECTING_FIELDS = [
  'entry',
  'stopLoss',
  'takeProfit',
  'execution',
] as const;

@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskCalculation: RiskCalculationService,
    private readonly tradeLog: TradeLogService,
  ) {}

  async create(createTradeDto: CreateTradeDto) {
    const data = {
      ...createTradeDto,
      stopLoss: JSON.parse(
        JSON.stringify(createTradeDto.stopLoss),
      ) as Prisma.InputJsonValue,
      takeProfit: JSON.parse(
        JSON.stringify(createTradeDto.takeProfit),
      ) as Prisma.InputJsonValue,
      // `isAutoClosed` is server-controlled: the client always submits the
      // default `false`, and only the auto-close job ever sets it true. Force it
      // here so a client cannot create an already-auto-closed trade.
      isAutoClosed: false,
    };
    return this.prisma.trade.create({ data });
  }

  async findAll(query: { userId: string }) {
    const userId: string = query.userId;
    return this.prisma.trade.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllWithJournal(query: { userId: string }) {
    const { userId } = query;
    return this.prisma.trade.findMany({
      where: {
        userId,
        plainText: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        symbol: true,
        plainText: true,
        editorState: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string) {
    const trade = this.prisma.trade.findUnique({
      where: {
        id,
      },
    });
    return trade;
  }

  async findOneForUser(id: string, userId: string) {
    const trade = await this.prisma.trade.findFirst({
      where: {
        id,
        userId,
      },
    });
    if (!trade) {
      throw new NotFoundException('Trade not found');
    }
    return trade;
  }

  async findByDateRange(dto: DateRangeDto) {
    const startDate = new Date(dto.start);
    const endDate = parseInclusiveDateRangeEnd(dto.end);
    const userId = dto.userId;
    return this.prisma.trade.findMany({
      where: {
        userId: userId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async findByDateRangeBySymbol(dto: SymbolDateRangeDto) {
    const startDate = new Date(dto.start);
    const endDate = dto.end ? parseInclusiveDateRangeEnd(dto.end) : new Date();
    const symbol = dto.symbol;
    const userId = dto.userId;
    return this.prisma.trade.findMany({
      where: {
        userId: userId,
        symbol,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });
  }

  async findBySymbol(dto: { symbol: string; userId: string }) {
    const { symbol, userId } = dto;
    return this.prisma.trade.findMany({
      where: {
        userId: userId,
        symbol,
      },
    });
  }

  async findByMultipleSymbols(dto: { symbols: string[]; userId: string }) {
    const { symbols, userId } = dto;
    return this.prisma.trade.findMany({
      where: {
        userId: userId,
        symbol: {
          in: symbols,
        },
      },
    });
  }

  async findByMultipleProperties(dto: MultiTradeDto) {
    const { userId, symbol, lot, pips, execution, status, start, end } = dto;
    const where: Prisma.tradeWhereInput = { userId: userId };

    if (symbol) where.symbol = symbol;
    if (lot) where.lot = lot;
    if (pips) where.pips = pips;
    if (execution) where.execution = execution;
    if (status) where.status = status;
    if (start || end) {
      where.createdAt = {};
      if (start) {
        where.createdAt.gte = new Date(start);
      }
      if (end) {
        where.createdAt.lte = parseInclusiveDateRangeEnd(end);
      }
    }
    return this.prisma.trade.findMany({ where });
  }

  async search(dto: SearchTradeDto) {
    const {
      userId,
      query,
      queryTerms,
      symbol,
      execution,
      status,
      statuses,
      start,
      end,
    } = dto;
    const where: Prisma.tradeWhereInput = { userId };

    if (symbol) where.symbol = symbol;
    if (execution) where.execution = execution;
    if (statuses?.length) {
      where.status = { in: statuses };
    } else if (status) {
      where.status = status;
    }

    if (start || end) {
      where.createdAt = {};
      if (start) {
        where.createdAt.gte = new Date(start);
      }
      if (end) {
        where.createdAt.lte = parseInclusiveDateRangeEnd(end);
      }
    }

    const searchTerms = [query, ...(queryTerms ?? [])]
      .map((term) => term?.trim())
      .filter((term): term is string => Boolean(term));
    const uniqueSearchTerms = [...new Set(searchTerms)];

    if (uniqueSearchTerms.length) {
      where.OR = uniqueSearchTerms.flatMap((term) => [
        { symbol: { contains: term, mode: 'insensitive' } },
        { plainText: { contains: term, mode: 'insensitive' } },
        { execution: { contains: term, mode: 'insensitive' } },
        { status: { contains: term, mode: 'insensitive' } },
      ]);
    }

    return this.prisma.trade.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Strips the read-only / server-controlled fields a client cannot set and
   * shapes the rest into Prisma update data. `isAutoClosed` is owned by the
   * auto-close job (which updates it directly), never by a client request.
   */
  private toUpdateData(
    updateTradeDto: UpdateTradeDto,
    preservePlannedRr = false,
  ): Prisma.tradeUpdateInput {
    const {
      id: _,
      createdAt,
      updatedAt,
      userId,
      accountCurrency: _accountCurrency,
      isAutoClosed: _isAutoClosed,
      ...updateData
    } = updateTradeDto;
    const { rr: _clientRr, ...updateDataWithoutRr } = updateData;
    const mutableUpdateData = preservePlannedRr
      ? updateDataWithoutRr
      : updateData;

    return {
      ...mutableUpdateData,
      stopLoss: mutableUpdateData.stopLoss as unknown as Prisma.InputJsonValue,
      takeProfit:
        mutableUpdateData.takeProfit as unknown as Prisma.InputJsonValue,
    };
  }

  async update(
    id: string,
    updateTradeDto: UpdateTradeDto,
    riskPatch?: Prisma.tradeUpdateInput,
    preservePlannedRr = false,
  ) {
    // `riskPatch` (server-recomputed exposure/sizing) is applied last so it wins
    // over the client-sent stop/target/lot values it derives from.
    const data: Prisma.tradeUpdateInput = {
      ...this.toUpdateData(updateTradeDto, preservePlannedRr),
      ...(riskPatch ?? {}),
    };
    return this.prisma.trade.update({ where: { id }, data });
  }

  async updateForUser(
    id: string,
    userId: string,
    updateTradeDto: UpdateTradeDto,
    language: string = 'en',
  ) {
    const existing = await this.findOneForUser(id, userId);
    const preservePlannedRr =
      existing.status === 'open' && existing.capitalExposurePct !== null;

    // An open trade moving to a PnL-settling status (closed_in_profit/
    // closed_in_loss/reached_tp/reached_sl) is a realized close. Delegate to the
    // risk module so PnL is computed and balance + drawdown settle atomically
    // with the close — the generic update path never settles. The neutral
    // 'closed' status is intentionally not in SETTLED_STATUSES, so a neutral
    // close still flows through the plain update below (no settlement, by design).
    const finalStatus = updateTradeDto.status ?? existing.status;

    // Reject attempts to reopen a trade that has already settled PnL. Allowing
    // this would let the same trade be closed again and settle PnL twice.
    if (SETTLED_STATUSES.has(existing.status) && finalStatus === 'open') {
      throw new BadRequestException(
        'Cannot reopen a settled trade. The trade has already had its PnL applied to the account.',
      );
    }

    if (existing.status === 'open' && SETTLED_STATUSES.has(finalStatus)) {
      return this.tradeLog.settleManualClose(
        userId,
        existing,
        this.toUpdateData(updateTradeDto, preservePlannedRr),
        updateTradeDto.closedPrice ?? 0,
        language,
      );
    }

    const riskPatch = await this.buildRiskRecompute(
      userId,
      existing,
      updateTradeDto,
    );
    return this.update(
      id,
      updateTradeDto,
      riskPatch ?? undefined,
      preservePlannedRr,
    );
  }

  /**
   * When an open, risk-engine-tracked trade has its entry / stop / target / lot
   * (or execution / symbol) edited, re-size it server-side so its stored capital
   * exposure stays accurate. The portfolio exposure snapshot
   * ({@link PortfolioService#getSnapshot}) sums each open trade's stored
   * `capitalExposure`/`capitalExposurePct`; without this recompute those figures
   * go stale on edit and the snapshot reports wrong exposure.
   *
   * Returns `null` (no recompute) when the edit can't or shouldn't change
   * exposure:
   *  - the trade is not (or is no longer) `open` — the snapshot only reads open
   *    trades, so a closed trade's exposure is historical;
   *  - no exposure-affecting field changed;
   *  - the trade predates the risk engine (`capitalExposurePct` is null) and so
   *    never contributed to exposure;
   *
   * Tracked trades fail the edit if recomputation fails. Persisting the primary
   * edit without its derived fields would leave portfolio exposure silently
   * stale.
   */
  private async buildRiskRecompute(
    userId: string,
    existing: trade,
    dto: UpdateTradeDto,
  ): Promise<Prisma.tradeUpdateInput | null> {
    const finalStatus = dto.status ?? existing.status;
    if (finalStatus !== 'open') return null;

    const changed = RISK_AFFECTING_FIELDS.some(
      (field) => dto[field] !== undefined,
    );
    if (!changed) return null;

    const existingStop = existing.stopLoss as unknown as { value: number };
    const existingTarget = existing.takeProfit as unknown as { value: number };

    const entry = dto.entry ?? existing.entry;
    const stopPrice = dto.stopLoss?.value ?? existingStop.value;
    const rawTarget = dto.takeProfit?.value ?? existingTarget.value;
    const lot = dto.lot ?? existing.lot;
    const execution = (dto.execution ?? existing.execution) as 'buy' | 'sell';
    const symbol = dto.symbol ?? existing.symbol;
    const targetPrice = rawTarget > 0 ? rawTarget : undefined;

    if (existing.capitalExposurePct === null) {
      if (GEOMETRY_AFFECTING_FIELDS.some((field) => dto[field] !== undefined)) {
        this.riskCalculation.validateActiveTradeGeometry({
          symbol,
          execution,
          entry,
          stopPrice,
          targetPrice,
        });
      }
      return null;
    }

    const calculation = await this.riskCalculation.calculateActiveTrade(
      userId,
      existing.accountCurrency,
      {
        symbol,
        execution,
        entry,
        stopPrice,
        targetPrice,
        lot: lot > 0 ? lot : undefined,
      },
    );

    const reward =
      calculation.rewardPips !== null
        ? calculation.rewardPips *
          calculation.pipValue *
          calculation.lotSizeRounded
        : 0;

    return {
      lot: calculation.lotSizeRounded,
      exchangeRate: calculation.exchangeRate,
      risk: calculation.actualCapitalExposure,
      reward,
      capitalExposure: calculation.actualCapitalExposure,
      capitalExposurePct: calculation.capitalExposurePct,
      // Keep the persisted stop/target pips consistent with the recompute.
      stopLoss: {
        value: calculation.stopPrice,
        pips: calculation.stopDistancePips,
      } as unknown as Prisma.InputJsonValue,
      takeProfit: {
        value: calculation.targetPrice ?? 0,
        pips: calculation.rewardPips ?? 0,
      } as unknown as Prisma.InputJsonValue,
    };
  }

  async remove(id: string) {
    return this.prisma.trade.delete({ where: { id } });
  }

  async removeForUser(id: string, userId: string) {
    const { count } = await this.prisma.trade.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Trade not found');
    }
    return { deleted: true };
  }
}
