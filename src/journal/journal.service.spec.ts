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
});
