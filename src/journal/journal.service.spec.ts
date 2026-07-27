import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalService } from './journal.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalDto } from './dto/create-journal.dto';

describe('JournalService', () => {
  let service: JournalService;
  let journalCreate: jest.Mock;
  let tradeFindFirst: jest.Mock;

  beforeEach(async () => {
    journalCreate = jest.fn();
    tradeFindFirst = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalService,
        {
          provide: PrismaService,
          useValue: {
            journal: { create: journalCreate },
            trade: { findFirst: tradeFindFirst },
          },
        },
      ],
    }).compile();

    service = module.get<JournalService>(JournalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
        include: { author: true },
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
