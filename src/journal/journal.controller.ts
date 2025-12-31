import { Controller, Get, Post, Body, Put, Param, Delete, Query } from '@nestjs/common';
import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { SearchJournalDto } from './dto/search-journal.dto';
import { IJournal } from './interfaces/journal.interface';

@Controller('journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Post()
  create(@Body() createJournalDto: CreateJournalDto) {
    return this.journalService.create(createJournalDto);
  }

  @Get()
  async findAll(): Promise<IJournal[]> {
    try {
      return await this.journalService.findAll();
    }
    catch (error) {
      console.error('Error fetching journal entries:', error);
      throw error; // Re-throw the error to be handled by NestJS
    }
  }

  @Get('search')
  async search(@Query() searchDto: SearchJournalDto): Promise<IJournal[]> {
    try {
      return await this.journalService.search(searchDto);
    }
    catch (error) {
      console.error('Error searching journal entries:', error);
      throw error;
    }
  }

  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string): Promise<IJournal[]> {
    try {
      return await this.journalService.findByUserId(userId);
    }
    catch (error) {
      console.error('Error fetching user journal entries:', error);
      throw error;
    }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.journalService.findOne(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateJournalDto: UpdateJournalDto) {
    return this.journalService.update(id, updateJournalDto);
  }

  /*
  @Patch(':id/archive')
  update(@Param('id') id: string, @Body() updateJournalDto: UpdateJournalDto) {
    return this.journalService.update(+id, updateJournalDto);
  }*/

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.journalService.remove(id);
  }
}
