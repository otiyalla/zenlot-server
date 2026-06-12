import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { DateRangeDto } from './dto/date-range.dto';
import { SymbolDateRangeDto } from './dto/symbol-date-range.dto';
import { MultiTradeDto } from './dto/multiple-properties.dto';
import { SearchTradeDto } from './dto/search-trade.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/prisma/client';

@Injectable()
export class TradeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTradeDto: CreateTradeDto) {
    const data = {
      ...createTradeDto,
      stopLoss: JSON.parse(JSON.stringify(createTradeDto.stopLoss)),
      takeProfit: JSON.parse(JSON.stringify(createTradeDto.takeProfit)),
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
    const endDate = new Date(dto.end);
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
    const endDate = dto.end ? new Date(dto.end) : new Date();
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
        where.createdAt.lte = new Date(end);
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
        where.createdAt.lte = new Date(end);
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

  async update(id: string, updateTradeDto: UpdateTradeDto) {
    // Remove read-only fields that shouldn't be updated
    const {
      id: _,
      createdAt,
      updatedAt,
      userId,
      ...updateData
    } = updateTradeDto;

    // Build the data object, only including defined (non-undefined) fields
    const data: Prisma.tradeUpdateInput = {
      ...updateData,
      stopLoss: updateData.stopLoss as unknown as Prisma.InputJsonValue,
      takeProfit: updateData.takeProfit as unknown as Prisma.InputJsonValue,
    };
    return this.prisma.trade.update({ where: { id }, data });
  }

  async updateForUser(
    id: string,
    userId: string,
    updateTradeDto: UpdateTradeDto,
  ) {
    await this.findOneForUser(id, userId);
    return this.update(id, updateTradeDto);
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
