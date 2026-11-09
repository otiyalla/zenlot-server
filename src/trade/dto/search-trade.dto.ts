import {
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SearchTradeDto {
  @IsUUID()
  @IsOptional()
  @ApiProperty({ description: 'The trade user id', required: false })
  userId?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description:
      'Text search query for symbol, journal content, execution, or status',
    required: false,
  })
  query?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @ApiProperty({
    description:
      'Additional text search terms, for example localized labels mapped to stored keys',
    required: false,
    type: [String],
  })
  queryTerms?: string[];

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'The instrument/currency of the trade entered',
    required: false,
  })
  symbol?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'The trade execution, if it is a buy or sell',
    required: false,
  })
  execution?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The trade status', required: false })
  status?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  )
  @ApiProperty({
    description: 'Multiple trade statuses',
    required: false,
    type: [String],
  })
  statuses?: string[];

  @IsISO8601()
  @IsOptional()
  @ApiProperty({
    type: Date,
    description: 'Start date for date range',
    required: false,
  })
  start?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({
    type: Date,
    description: 'End date for date range',
    required: false,
  })
  end?: string;
}
