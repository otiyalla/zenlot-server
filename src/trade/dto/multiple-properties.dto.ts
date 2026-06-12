import {
  IsOptional,
  IsISO8601,
  IsString,
  IsNumber,
  IsUUID,
  IsIn,
  IsPositive,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MultiTradeDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade user id' })
  userId: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z]{6}$/)
  @ApiProperty({ description: 'The instrument/currency of the trade entered' })
  symbol?: string;

  @IsNumber()
  @IsOptional()
  @IsPositive()
  @ApiProperty({ description: 'The trade lot size' })
  lot?: number;

  @IsNumber()
  @IsOptional()
  @IsPositive()
  @ApiProperty({ description: 'The trade pips value' })
  pips?: number;

  @IsString()
  @IsOptional()
  @IsIn(['buy', 'sell'])
  @ApiProperty({ description: 'The trade execution, if it is a buy or sell' })
  execution?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'open',
    'close',
    'closed',
    'reached_tp',
    'reached_sl',
    'pending',
    'closed_in_profit',
    'closed_in_loss',
  ])
  @ApiProperty({ description: 'The trade status' })
  status?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({ type: Date, description: 'The date of the journal entry' })
  start?: string;

  @IsISO8601()
  @IsOptional()
  @ApiProperty({
    type: Date,
    description: 'The last updated date of the journal entry',
  })
  end?: string;
}
