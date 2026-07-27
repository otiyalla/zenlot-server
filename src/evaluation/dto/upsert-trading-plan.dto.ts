import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { StopPlacement } from '../engine';

const STOP_PLACEMENTS: StopPlacement[] = [
  'swing_extreme',
  'fixed_pips',
  'atr_based',
  'custom',
];

/**
 * The trader's required-condition flags (spec Section 3). Mirrors the engine's
 * {@link TradingPlanEntryConditions} interface 1:1.
 */
export class TradingPlanEntryConditionsDto {
  @IsBoolean()
  @ApiProperty()
  requiresMomentumAlignment: boolean;

  @IsBoolean()
  @ApiProperty()
  requiresPattern: boolean;

  @IsBoolean()
  @ApiProperty()
  requiresPriceZone: boolean;

  @IsBoolean()
  @ApiProperty()
  requiresTimeConfluence: boolean;

  @IsBoolean()
  @ApiProperty()
  requiredCandlestickSignal: boolean;

  @IsString()
  @ApiProperty({ description: 'Free-text extra entry conditions' })
  customConditions: string;
}

export class TradingPlanStopRulesDto {
  @IsIn(STOP_PLACEMENTS)
  @ApiProperty({ enum: STOP_PLACEMENTS })
  placement: StopPlacement;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ description: 'Required when placement = fixed_pips' })
  fixedPips?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Required when placement = custom' })
  customDescription?: string;
}

export class TradingPlanExitRulesDto {
  @IsString()
  @ApiProperty({ description: 'First scale-out / exit rule' })
  unit1: string;

  @IsString()
  @ApiProperty({ description: 'Second scale-out / exit rule' })
  unit2: string;
}

export class TradingPlanSessionRulesDto {
  @IsBoolean()
  @ApiProperty()
  avoidHighImpactNews: boolean;

  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    type: [String],
    description: 'Sessions the trader trades, e.g. ["london", "newyork"]',
  })
  tradingSessionsOnly: string[];

  @IsInt()
  @Min(0)
  @ApiProperty({ description: '0 = no limit' })
  maxTradesPerDay: number;
}

/**
 * Body for PUT /evaluation/plan. Saving always creates a NEW version row and
 * flips the previous current plan to isCurrent=false (handled in the service).
 * `userId`, `version`, and `updatedAt` are server-owned and never accepted here.
 */
export class UpsertTradingPlanDto {
  @ValidateNested()
  @Type(() => TradingPlanEntryConditionsDto)
  @ApiProperty({ type: TradingPlanEntryConditionsDto })
  entryConditions: TradingPlanEntryConditionsDto;

  @ValidateNested()
  @Type(() => TradingPlanStopRulesDto)
  @ApiProperty({ type: TradingPlanStopRulesDto })
  stopRules: TradingPlanStopRulesDto;

  @ValidateNested()
  @Type(() => TradingPlanExitRulesDto)
  @ApiProperty({ type: TradingPlanExitRulesDto })
  exitRules: TradingPlanExitRulesDto;

  @ValidateNested()
  @Type(() => TradingPlanSessionRulesDto)
  @ApiProperty({ type: TradingPlanSessionRulesDto })
  sessionRules: TradingPlanSessionRulesDto;
}
