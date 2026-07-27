import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalDto } from './dto/create-journal.dto';

const SAFE_AUTHOR_INCLUDE = {
  author: {
    select: {
      id: true,
      fname: true,
      lname: true,
    },
  },
};

describe('JournalService', () => {
  let service: JournalService;
  let journalCreate: jest.Mock;
  let tradeFindFirst: jest.Mock;

  const prisma = {
    journal: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    trade: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const createDto: CreateJournalDto = {
    userId: '00000000-0000-4000-8000-000000000001',
    symbol: 'EURUSD',
    title: 'Trade review',
    tags: ['review'],
    plainText: 'Followed the plan',
    isPinned: false,
    isArchived: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JournalService(prisma as unknown as PrismaService);
    journalCreate = prisma.journal.create as jest.Mock;
    tradeFindFirst = prisma.trade.findFirst as jest.Mock;
    prisma.journal.create.mockResolvedValue({ id: 'journal-1' });
    prisma.journal.findMany.mockResolvedValue([]);
    prisma.journal.findUnique.mockResolvedValue({ id: 'journal-1' });
    prisma.journal.findFirst.mockResolvedValue({ id: 'journal-1' });
    prisma.journal.update.mockResolvedValue({ id: 'journal-1' });
    prisma.trade.findMany.mockResolvedValue([]);
  });

  it('selects only public author fields when creating a journal', async () => {
    await service.create(createDto);

    expect(prisma.journal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        include: SAFE_AUTHOR_INCLUDE,
      }),
    );
  });

  it('uses the safe author selection for all journal read paths', async () => {
    await service.findAll();
    await service.findOne('journal-1');
    await service.findOneByUser('journal-1', createDto.userId);

    expect(prisma.journal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: SAFE_AUTHOR_INCLUDE,
      }),
    );
    expect(prisma.journal.findUnique).toHaveBeenCalledWith({
      where: { id: 'journal-1' },
      include: SAFE_AUTHOR_INCLUDE,
    });
    expect(prisma.journal.findFirst).toHaveBeenCalledWith({
      where: { id: 'journal-1', userId: createDto.userId },
      include: SAFE_AUTHOR_INCLUDE,
    });
  });

  it('keeps the trade relation while restricting author fields in user journal lists', async () => {
    await service.findByUserId(createDto.userId);

    expect(prisma.journal.findMany).toHaveBeenCalledWith({
      where: { userId: createDto.userId },
      include: {
        ...SAFE_AUTHOR_INCLUDE,
        trade: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it.each([
    {
      caseName: 'journal-only pinned search',
      searchDto: { userId: createDto.userId, isPinned: true },
      expectsTradeSearch: false,
    },
    {
      caseName: 'combined journal and trade search',
      searchDto: { userId: createDto.userId, query: 'plan' },
      expectsTradeSearch: true,
    },
  ])(
    'uses the safe author selection for $caseName',
    async ({ searchDto, expectsTradeSearch }) => {
      await service.search(searchDto);

      expect(prisma.journal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: SAFE_AUTHOR_INCLUDE,
        }),
      );
      if (expectsTradeSearch) {
        expect(prisma.trade.findMany).toHaveBeenCalledTimes(1);
      } else {
        expect(prisma.trade.findMany).not.toHaveBeenCalled();
      }
    },
  );

  it('uses the safe author selection when updating a journal', async () => {
    await service.update('journal-1', { title: 'Updated review' });

    expect(prisma.journal.update).toHaveBeenCalledWith({
      where: { id: 'journal-1' },
      data: { title: 'Updated review' },
      include: SAFE_AUTHOR_INCLUDE,
    });
  });

  it('uses the safe author selection for both ownership lookup and user-scoped update', async () => {
    await service.updateByUser('journal-1', createDto.userId, {
      title: 'Updated review',
    });

    expect(prisma.journal.findFirst).toHaveBeenCalledWith({
      where: { id: 'journal-1', userId: createDto.userId },
      include: SAFE_AUTHOR_INCLUDE,
    });
    expect(prisma.journal.update).toHaveBeenCalledWith({
      where: { id: 'journal-1' },
      data: { title: 'Updated review' },
      include: SAFE_AUTHOR_INCLUDE,
    });
  });

  describe('create', () => {
    const baseDto = {
      userId: 'owner-1',
      symbol: 'EURUSD',
      title: 'Trading plan',
      tags: ['plan'],
      plainText: 'Wait for confirmation',
      editorState: '{}',
      isPinned: false,
      isArchived: false,
    } as CreateJournalDto;

    it('creates a journal without a trade ownership lookup when tradeId is omitted', async () => {
      const createdJournal = { id: 'journal-1', ...baseDto };
      journalCreate.mockResolvedValue(createdJournal);

      await expect(service.create(baseDto)).resolves.toBe(createdJournal);

      expect(tradeFindFirst).not.toHaveBeenCalled();
      expect(journalCreate).toHaveBeenCalledWith({
        data: {
          ...baseDto,
          tradeId: undefined,
        },
        include: SAFE_AUTHOR_INCLUDE,
      });
    });

    it('creates a journal linked to a trade owned by the journal user', async () => {
      const dto = { ...baseDto, tradeId: 'trade-1' };
      const createdJournal = { id: 'journal-1', ...dto };
      tradeFindFirst.mockResolvedValue({ id: 'trade-1' });
      journalCreate.mockResolvedValue(createdJournal);

      await expect(service.create(dto)).resolves.toBe(createdJournal);

      expect(tradeFindFirst).toHaveBeenCalledWith({
        where: { id: 'trade-1', userId: 'owner-1' },
        select: { id: true },
      });
      expect(journalCreate).toHaveBeenCalledTimes(1);
    });

    it.each(['a foreign', 'a nonexistent'])(
      'rejects %s trade without attempting journal creation',
      async () => {
        const dto = { ...baseDto, tradeId: 'unavailable-trade' };
        tradeFindFirst.mockResolvedValue(null);

        await expect(service.create(dto)).rejects.toEqual(
          new NotFoundException('Trade not found'),
        );

        expect(tradeFindFirst).toHaveBeenCalledWith({
          where: { id: 'unavailable-trade', userId: 'owner-1' },
          select: { id: true },
        });
        expect(journalCreate).not.toHaveBeenCalled();
      },
    );
  });
});
