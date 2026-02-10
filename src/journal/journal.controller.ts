import {
  Controller,
  Get,
  Logger,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { JournalService } from './journal.service';
import { CreateJournalDto } from './dto/create-journal.dto';
import { UpdateJournalDto } from './dto/update-journal.dto';
import { SearchJournalDto } from './dto/search-journal.dto';
import { IJournal } from './interfaces/journal.interface';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Journal')
@ApiSecurity('access-token')
@Controller('journal')
export class JournalController {
  private readonly logger = new Logger(JournalController.name);

  constructor(private readonly journalService: JournalService) {}

  @Post()
  @ApiOperation({ summary: 'Create a journal entry' })
  @ApiResponse({
    status: 201,
    description: 'Journal entry created successfully.',
  })
  create(@Body() createJournalDto: CreateJournalDto) {
    return this.journalService.create(createJournalDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all journal entries' })
  @ApiResponse({
    status: 200,
    description: 'Journal entries fetched successfully.',
  })
  async findAll(): Promise<IJournal[]> {
    try {
      return await this.journalService.findAll();
    } catch (error) {
      this.logger.error('Error fetching journal entries', error);
      Sentry.captureException(error, { extra: { context: 'findAll' } });
      throw error; // Re-throw the error to be handled by NestJS
    }
  }

  @Get('search')
  @ApiOperation({ summary: 'Search journal entries' })
  @ApiQuery({ name: 'userId', required: false, description: 'User id' })
  @ApiQuery({ name: 'query', required: false, description: 'Text query' })
  @ApiQuery({
    name: 'symbol',
    required: false,
    description: 'Instrument symbol',
  })
  @ApiQuery({
    name: 'tags',
    required: false,
    isArray: true,
    description: 'Tags',
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
  @ApiQuery({ name: 'isPinned', required: false, description: 'Pinned status' })
  @ApiQuery({
    name: 'isArchived',
    required: false,
    description: 'Archived status',
  })
  @ApiResponse({
    status: 200,
    description: 'Journal entries fetched successfully.',
  })
  async search(@Query() searchDto: SearchJournalDto): Promise<IJournal[]> {
    try {
      return await this.journalService.search(searchDto);
    } catch (error) {
      this.logger.error('Error searching journal entries', error);
      Sentry.captureException(error, {
        extra: { context: 'search', searchDto },
      });
      throw error;
    }
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get journal entries by user id' })
  @ApiParam({ name: 'userId', required: true, description: 'User id' })
  @ApiResponse({
    status: 200,
    description: 'Journal entries fetched successfully.',
  })
  async findByUserId(@Param('userId') userId: string): Promise<IJournal[]> {
    try {
      return await this.journalService.findByUserId(userId);
    } catch (error) {
      this.logger.error('Error fetching user journal entries', error);
      Sentry.captureException(error, {
        extra: { userId, context: 'findByUserId' },
      });
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a journal entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'Journal entry id' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry fetched successfully.',
  })
  findOne(@Param('id') id: string) {
    return this.journalService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a journal entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'Journal entry id' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry updated successfully.',
  })
  update(@Param('id') id: string, @Body() updateJournalDto: UpdateJournalDto) {
    return this.journalService.update(id, updateJournalDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a journal entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'Journal entry id' })
  @ApiResponse({
    status: 200,
    description: 'Journal entry deleted successfully.',
  })
  remove(@Param('id') id: string) {
    return this.journalService.remove(id);
  }
}
