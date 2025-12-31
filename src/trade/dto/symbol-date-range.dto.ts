import { IsISO8601, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SymbolDateRangeDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade owner id' })
  userId: string;
  
  @IsString()
  symbol: string;

  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}