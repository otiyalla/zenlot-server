import { IsOptional, IsISO8601, IsString, IsNumber, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchJournalDto {
  @IsNumber()
  @IsOptional()
  @ApiProperty({ description: 'The user id to filter journals', required: false })
  userId?: number;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Text search query for plainText, title, tags, or symbol', required: false })
  query?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Filter by currency symbol', required: false })
  symbol?: string;

  @IsArray()
  @IsOptional()
  @ApiProperty({ description: 'Filter by tags array', required: false, type: [String] })
  tags?: string[];

  @IsISO8601()
  @IsOptional()
  @ApiProperty({ description: 'Start date for date range filter', required: false })
  start?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({ description: 'End date for date range filter', required: false })
  end?: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Filter by pinned status', required: false })
  isPinned?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Filter by archived status', required: false })
  isArchived?: boolean;
}

