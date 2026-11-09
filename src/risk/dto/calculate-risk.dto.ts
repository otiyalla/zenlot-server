import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A pre-trade setup to size and govern. Uses the app's vocabulary
 * (`symbol`, `execution: buy|sell`); the service maps execution→direction
 * (buy ≡ long, sell ≡ short) before calling the engine. The account currency is
 * taken from the authenticated user, not the body.
 */
export class CalculateRiskDto {
  @IsString()
  @Matches(/^[A-Za-z]{6}$/)
  @ApiProperty({ description: 'Instrument symbol, e.g. EURUSD or XAUUSD' })
  symbol: string;

  @IsString()
  @IsIn(['buy', 'sell'])
  @ApiProperty({ description: 'Trade execution: buy (long) or sell (short)' })
  execution: 'buy' | 'sell';

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'Entry price' })
  entry: number;

  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'Initial protective stop price' })
  stopPrice: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiPropertyOptional({
    description: 'Optional target price (enables reward-to-risk)',
  })
  targetPrice?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  @ApiPropertyOptional({
    description:
      'Optional user-chosen lot size. Overrides the engine recommendation; exposure is computed from this value.',
  })
  lot?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Optional trade journal content in plain text',
  })
  plainText?: string | null;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Optional trade journal content in editor format',
  })
  editorState?: string | null;
}
