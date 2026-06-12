import { IsISO8601, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SymbolDateRangeDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade owner id' })
  userId: string;

  @IsString()
  @Matches(/^[A-Za-z]{6}$/)
  symbol: string;

  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}
