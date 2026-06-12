import { PartialType } from '@nestjs/swagger';
import { CreateTradeDto } from './create-trade.dto';
import {
  IsArray,
  IsString,
  IsNumber,
  IsDate,
  IsOptional,
  IsUUID,
  IsPositive,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateTradeDto extends PartialType(CreateTradeDto) {
  @IsUUID()
  @ApiProperty({ description: 'The unique identifier for the trade' })
  id: string;

  @IsNumber()
  @IsOptional()
  @IsPositive()
  @ApiProperty({ description: 'Risk reward ratio' })
  rr: number;

  @IsNumber()
  @IsOptional()
  @IsPositive()
  @ApiProperty({ description: 'The trade risk' })
  risk: number;

  @IsNumber()
  @IsOptional()
  @IsPositive()
  @ApiProperty({ description: 'The trade reward' })
  reward: number;

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  @ApiProperty({ description: 'The trade tags' })
  tags: string[];

  @IsDate()
  @ApiProperty({ type: Date, description: 'The date of the journal entry' })
  createdAt: Date;

  @IsDate()
  @ApiProperty({
    type: Date,
    description: 'The last updated date of the journal entry',
  })
  updatedAt: Date;

  @IsOptional()
  @IsDate()
  closedAt?: Date;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  closedPrice?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  closedExchangeRate?: number;

  @IsOptional()
  @IsString()
  closedReason?: string;
}
