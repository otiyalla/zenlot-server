import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID } from 'class-validator';
    
export class DateRangeDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade owner id' })
  userId: string;

  @IsISO8601()
  start: string;

  @IsISO8601()
  end: string;
}
 
/*
import { IsInt, IsISO8601, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class DateRangeDto {
  @ApiProperty({ description: 'The trade owner id' })
  @IsInt()
  @Type(() => Number) // converts "2" -> 2
  userId: number;

  @IsISO8601()
  start: string; // e.g. "2025-08-10"

  @IsISO8601()
  end: string;   // e.g. "2025-08-17"
}
*/