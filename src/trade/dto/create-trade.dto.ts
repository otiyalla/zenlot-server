import {
  IsArray,
  IsString,
  IsNumber,
  IsOptional,
  ValidateNested,
  IsUUID,
  IsBoolean,
  IsIn,
  IsPositive,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class ExitValue {
  @IsNumber()
  @IsPositive()
  value: number;

  @IsNumber()
  @IsPositive()
  pips: number;
}

export class CreateTradeDto {
  /*
    @IsNumber()
    @ApiProperty({ description: 'The unique identifier for the trade' })
    //id: number;
*/
  @IsUUID()
  @ApiProperty({ description: 'The trade user id' })
  userId: string;

  @IsString()
  @Matches(/^[A-Za-z]{6}$/)
  @ApiProperty({ description: 'The instrument/currency of the trade entered' })
  symbol: string;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The trade entry value' })
  entry: number;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The trade lot size' })
  lot: number;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The trade pips value' })
  pips: number;

  @IsString()
  @IsIn(['buy', 'sell'])
  @ApiProperty({ description: 'The trade execution, if it is a buy or sell' })
  execution: string;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  @ApiProperty({ description: 'The trade account currency' })
  accountCurrency: string;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The trade exchange rate' })
  exchangeRate: number;

  @ValidateNested()
  @Type(() => ExitValue)
  @ApiProperty({ type: ExitValue, description: 'The trade stop loss value' })
  stopLoss: ExitValue;

  @ValidateNested()
  @Type(() => ExitValue)
  @ApiProperty({ type: ExitValue, description: 'The trade take profit value' })
  takeProfit: ExitValue;

  @IsString()
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
  @IsOptional()
  @ApiProperty({ description: 'The trade journal content in plain text' })
  plainText: string | undefined | null;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'The trade journal content in editor format' })
  editorState: string | undefined | null;

  @IsString()
  @ApiProperty({ description: 'The trade status' })
  status: string;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({
    required: false,
    description: 'Whether the trade was closed automatically',
  })
  isAutoClosed?: boolean;

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
}
