import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { TIMEFRAMES, Timeframe } from '../interface/candle.interface';

export class CandleQueryDto {
  @IsString()
  @Matches(/^[A-Za-z]{6}$/, {
    message: 'symbol must be a 6-letter pair, e.g. EURUSD',
  })
  @ApiProperty({
    description: 'Canonical 6-letter forex pair',
    example: 'EURUSD',
  })
  symbol: string;

  @IsIn(TIMEFRAMES)
  @ApiProperty({ enum: TIMEFRAMES, example: 'H1' })
  timeframe: Timeframe;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description:
      'Window start, epoch milliseconds (UTC). Defaults to ~300 bars back.',
  })
  from?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Window end, epoch milliseconds (UTC). Defaults to now.',
  })
  to?: number;

  @ValidateIf((o: CandleQueryDto) => o.from !== undefined && o.to !== undefined)
  @IsIn([true], {
    message: 'from must be earlier than to',
  })
  get fromBeforeTo(): boolean {
    return (this.from ?? 0) < (this.to ?? Infinity);
  }
}
