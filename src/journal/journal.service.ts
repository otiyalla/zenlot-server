import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { SearchJournalDto } from './dto/search-journal.dto';
import { IJournal } from './interfaces/journal.interface';
import { Prisma } from '../../prisma/generated/prisma/client';
//import { TradeService } from 'src/trade/trade.service';

@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  create(createJournalDto: CreateJournalDto) {
    // Ensure user exists
    const data = {
      userId: createJournalDto.userId,
      symbol: createJournalDto.symbol,
      title: createJournalDto.title,
      tags: createJournalDto.tags ?? [],
      tradeId: createJournalDto.tradeId,
      plainText: createJournalDto.plainText,
      editorState: createJournalDto.editorState,
      isPinned: createJournalDto.isPinned ?? false,
      isArchived: createJournalDto.isArchived ?? false,
    };
    const journals = this.prisma.journal.create({
      data,
      include: { author: true },
    });
    return journals;
  }

  async findAll(): Promise<IJournal[]> {
    return this.prisma.journal.findMany({
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    }) as unknown as IJournal[];
  }

  async findByUserId(userId: string): Promise<IJournal[]> {
    const tradeJournals = await this.prisma.trade.findMany({
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

    const mappedTradeJournals: IJournal[] = tradeJournals.map((trade) => ({
      id: trade.id,
      tradeId: trade.id,
      userId: trade.userId,
      symbol: trade.symbol,
      plainText: trade.plainText ?? undefined,
      editorState: trade.editorState ?? undefined,
      tags: trade.tags,
      createdAt: trade.createdAt,
      updatedAt: trade.updatedAt,
    }));

    const journals = (await this.prisma.journal.findMany({
      where: { userId },
      include: { author: true, trade: true },
      orderBy: { createdAt: 'desc' },
    })) as unknown as IJournal[];
    
    return [...journals, ...mappedTradeJournals].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async findOne(id: string) {
    const entry = await this.prisma.journal.findUnique({
      where: { id },
      include: { author: true },
    });
    if (!entry) throw new NotFoundException('Journal not found');
    return entry;
  }

  async search(searchDto: SearchJournalDto): Promise<IJournal[]> {
    const where: Prisma.journalWhereInput = {};

    // User filter
    if (searchDto.userId !== undefined) {
      where.userId = searchDto.userId;
    }

    // Symbol filter
    if (searchDto.symbol) {
      where.symbol = searchDto.symbol;
    }

    // Tags filter - array contains
    if (searchDto.tags && searchDto.tags.length > 0) {
      where.tags = {
        hasSome: searchDto.tags,
      };
    }

    // Date range filter
    if (searchDto.start || searchDto.end) {
      where.createdAt = {};
      if (searchDto.start) {
        where.createdAt.gte = new Date(searchDto.start);
      }
      if (searchDto.end) {
        where.createdAt.lte = new Date(searchDto.end);
      }
    }

    // Pinned filter
    if (searchDto.isPinned !== undefined) {
      where.isPinned = searchDto.isPinned;
    }

    // Archived filter
    if (searchDto.isArchived !== undefined) {
      where.isArchived = searchDto.isArchived;
    }

    // Text search in plainText, title, tags, or symbol
    if (searchDto.query) {
      const query = searchDto.query.toLowerCase();
      where.OR = [
        { plainText: { contains: query, mode: 'insensitive' } },
        { symbol: { contains: query, mode: 'insensitive' } },
        { title: { contains: query, mode: 'insensitive' } },
        { tags: { hasSome: [query] } },
      ];
      // Add title search if title field exists
      if (where.OR) {
        where.OR.push({
          title: { contains: query, mode: 'insensitive' } as any,
        });
      }
    }

    return this.prisma.journal.findMany({
      where,
      include: { author: true },
      orderBy: { createdAt: 'desc' },
    }) as unknown as IJournal[];
  }

  update(id: string, journalUpdate: UpdateJournalDto) {
    const data: Prisma.journalUpdateInput = {};

    if (journalUpdate.symbol !== undefined) data.symbol = journalUpdate.symbol;
    if (journalUpdate.title !== undefined) data.title = journalUpdate.title;
    if (journalUpdate.tags !== undefined) data.tags = journalUpdate.tags;
    if (journalUpdate.plainText !== undefined)
      data.plainText = journalUpdate.plainText;
    if (journalUpdate.editorState !== undefined)
      data.editorState = journalUpdate.editorState;
    if (journalUpdate.isPinned !== undefined)
      data.isPinned = journalUpdate.isPinned;
    if (journalUpdate.isArchived !== undefined)
      data.isArchived = journalUpdate.isArchived;

    if (journalUpdate.tradeId)
      return this.prisma.trade.update({
        where: { id: journalUpdate.tradeId },
        data,
      });
    else
      return this.prisma.journal.update({
        where: { id },
        data,
        include: { author: true },
      });
  }

  remove(id: string) {
    return this.prisma.journal.delete({ where: { id } });
  }
}
