import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { HistoryService } from './history.service';
import { CreateHistoryDto } from './dto/create-history.dto';
import { UpdateHistoryDto } from './dto/update-history.dto';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('History')
@ApiSecurity('access-token')
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Post()
  @ApiOperation({ summary: 'Create a history entry' })
  @ApiResponse({
    status: 201,
    description: 'History entry created successfully.',
  })
  create(@Body() createHistoryDto: CreateHistoryDto) {
    return this.historyService.create(createHistoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all history entries' })
  @ApiResponse({
    status: 200,
    description: 'History entries fetched successfully.',
  })
  findAll() {
    return this.historyService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a history entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'History entry id' })
  @ApiResponse({
    status: 200,
    description: 'History entry fetched successfully.',
  })
  findOne(@Param('id') id: string) {
    return this.historyService.findOne(+id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a history entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'History entry id' })
  @ApiResponse({
    status: 200,
    description: 'History entry updated successfully.',
  })
  update(@Param('id') id: string, @Body() updateHistoryDto: UpdateHistoryDto) {
    return this.historyService.update(+id, updateHistoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a history entry by id' })
  @ApiParam({ name: 'id', required: true, description: 'History entry id' })
  @ApiResponse({
    status: 200,
    description: 'History entry deleted successfully.',
  })
  remove(@Param('id') id: string) {
    return this.historyService.remove(+id);
  }
}
