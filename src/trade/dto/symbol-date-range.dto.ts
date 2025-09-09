import { IsISO8601, IsString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SymbolDateRangeDto {
  @IsNumber()
  @ApiProperty({ description: 'The trade owner id' })
  userId: number;
  
  @IsString()
  symbol: string;

  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}