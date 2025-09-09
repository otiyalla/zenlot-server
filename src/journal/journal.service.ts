import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { IJournal } from './interfaces/journal.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  create(createJournalDto: CreateJournalDto) {
    // Ensure user exists
    const data = {
      userId: createJournalDto.userId,
      symbol: createJournalDto.symbol,
      plainText: createJournalDto.plainText,
      editorState: createJournalDto.editorState,
      isPinned: createJournalDto.isPinned ?? false,
      isArchived: createJournalDto.isArchived ?? false,
    }
    const journals = this.prisma.journal.create({ data, include: { author: true} });
    return journals;
  }

  
  async findAll(): Promise<IJournal[]> {
    return this.prisma.journal.findMany({ include: { author: true } }) as unknown as IJournal[];
  }

  async findOne(id: number) {
    const entry = await this.prisma.journal.findUnique({ where: { id }, include: { author: true } });
    if (!entry) throw new NotFoundException('Journal not found');
    return entry;
  }
  

  update(id: number, journalUpdate: UpdateJournalDto) {
     const data: Prisma.journalUpdateInput = { };

    if (journalUpdate.symbol !== undefined) data.symbol = journalUpdate.symbol;
    if (journalUpdate.plainText !== undefined) data.plainText = journalUpdate.plainText;
    if (journalUpdate.editorState !== undefined) data.editorState = journalUpdate.editorState;
    if (journalUpdate.isPinned !== undefined) data.isPinned = journalUpdate.isPinned;
    if (journalUpdate.isArchived !== undefined) data.isArchived = journalUpdate.isArchived;
    return this.prisma.journal.update({ where: { id }, data, include: { author: true} });
  }

  remove(id: number) {
    return this.prisma.journal.delete({ where: { id } });
  }
  /*

  findAll(): IJournal[] {
    return [{
      _id: '1',
      userId: 'user123',
      content: 'This is a sample journal entry content.',
      createdAt: new Date(),
      updatedAt: new Date(),
      isPinned: false,
      isArchived: false,
      currency: 'USDAUD',
    },
  {

    _id: '2',
    currency: 'EURUSD',
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'user456',
    content: 'This is another sample journal entry content.',
    isPinned: false,
    isArchived: false,
  }];
  }

  findOne(id: number) {
    return `This action returns a #${id} journal`;
  }

  update(id: number, updateJournalDto: UpdateJournalDto) {
    return `This action updates a #${id} journal`;
  }

  remove(id: number) {
    return `This action removes a #${id} journal`;
  }
    */
}
