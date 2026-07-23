import { IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloseTradeDto {
  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The price at which the trade was closed' })
  exitPrice: number;
}
