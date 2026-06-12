import {
  IsOptional,
  IsISO8601,
  IsString,
  IsNumber,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MultiTradeDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade user id' })
  userId: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The instrument/currency of the trade entered' })
  symbol?: string;

  @IsNumber()
  @IsOptional()
  @ApiProperty({ description: 'The trade lot size' })
  lot?: number;

  @IsNumber()
  @IsOptional()
  @ApiProperty({ description: 'The trade pips value' })
  pips?: number;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The trade execution, if it is a buy or sell' })
  execution?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The trade status' })
  status?: string;

  @IsISO8601()
  @ApiProperty({ type: Date, description: 'The date of the journal entry' })
  start?: string;

  @IsISO8601()
  @ApiProperty({
    type: Date,
    description: 'The last updated date of the journal entry',
  })
  end?: string;
}
