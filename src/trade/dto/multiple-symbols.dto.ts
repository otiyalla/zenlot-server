import { IsArray, IsString, IsUUID, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MultipleSymbolsDto {
  @IsUUID()
  @ApiProperty({ description: 'The trade owner id' })
  userId: string;

  @IsArray()
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{6}$/, { each: true })
  @ApiProperty({ type: [String], description: 'Instrument symbols' })
  symbols: string[];
}
