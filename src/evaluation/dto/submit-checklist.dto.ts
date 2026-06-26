import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  Confidence,
  EntryTriggerType,
  HigherTfDirection,
  LevelType,
  PatternType,
  StopLogicDeclared,
} from '../engine';

const HIGHER_TF_DIRECTIONS: HigherTfDirection[] = [
  'bullish',
  'bearish',
  'unclear',
];
const PATTERN_TYPES: PatternType[] = [
  'abc_correction',
  'five_wave_trend',
  'other',
  'none',
];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const LEVEL_TYPES: LevelType[] = [
  'fibonacci_retracement',
  'fibonacci_extension',
  'app',
  'support_resistance',
  'none',
];
const ENTRY_TRIGGER_TYPES: EntryTriggerType[] = [
  'trailing_1BH',
  'trailing_1BL',
  'swing_entry',
  'market',
  'limit',
  'other',
];
const STOP_LOGICS: StopLogicDeclared[] = [
  'swing_extreme',
  'fixed_pips',
  'arbitrary',
];

class MomentumDto {
  @IsIn(HIGHER_TF_DIRECTIONS)
  @ApiProperty({ enum: HIGHER_TF_DIRECTIONS })
  higherTfDirection: HigherTfDirection;

  @IsBoolean()
  @ApiProperty()
  lowerTfReversal: boolean;

  @IsString()
  @ApiProperty()
  note: string;
}

class PatternDto {
  @IsBoolean()
  @ApiProperty()
  identified: boolean;

  @IsIn(PATTERN_TYPES)
  @ApiProperty({ enum: PATTERN_TYPES })
  type: PatternType;

  @IsIn(CONFIDENCES)
  @ApiProperty({ enum: CONFIDENCES })
  confidence: Confidence;

  @IsString()
  @ApiProperty()
  note: string;
}

class PriceZoneDto {
  @IsBoolean()
  @ApiProperty()
  atSignificantLevel: boolean;

  @IsIn(LEVEL_TYPES)
  @ApiProperty({ enum: LEVEL_TYPES })
  levelType: LevelType;

  @IsBoolean()
  @ApiProperty()
  confluence: boolean;

  @IsString()
  @ApiProperty()
  note: string;
}

class TimeConfluenceDto {
  @IsBoolean()
  @ApiProperty()
  inTimeZone: boolean;

  @IsString()
  @ApiProperty()
  note: string;
}

class EntryTriggerDto {
  @IsIn(ENTRY_TRIGGER_TYPES)
  @ApiProperty({ enum: ENTRY_TRIGGER_TYPES })
  type: EntryTriggerType;

  @IsString()
  @ApiProperty()
  note: string;
}

class StopPlacementDto {
  @IsIn(STOP_LOGICS)
  @ApiProperty({ enum: STOP_LOGICS })
  logic: StopLogicDeclared;

  @IsString()
  @ApiProperty()
  note: string;
}

/**
 * Body for POST /evaluation/checklist (spec Section 4). NO tradeId is required:
 * the checklist is submitted before the trade is logged and back-filled when the
 * trade is created (soft-gate, decision #2). `submittedAt` is server-owned.
 */
export class SubmitChecklistDto {
  @ValidateNested()
  @Type(() => MomentumDto)
  @ApiProperty({ type: MomentumDto })
  momentum: MomentumDto;

  @ValidateNested()
  @Type(() => PatternDto)
  @ApiProperty({ type: PatternDto })
  pattern: PatternDto;

  @ValidateNested()
  @Type(() => PriceZoneDto)
  @ApiProperty({ type: PriceZoneDto })
  priceZone: PriceZoneDto;

  @ValidateNested()
  @Type(() => TimeConfluenceDto)
  @ApiProperty({ type: TimeConfluenceDto })
  timeConfluence: TimeConfluenceDto;

  @ValidateNested()
  @Type(() => EntryTriggerDto)
  @ApiProperty({ type: EntryTriggerDto })
  entryTrigger: EntryTriggerDto;

  @ValidateNested()
  @Type(() => StopPlacementDto)
  @ApiProperty({ type: StopPlacementDto })
  stopPlacement: StopPlacementDto;

  @IsIn(CONFIDENCES)
  @ApiProperty({ enum: CONFIDENCES })
  overallConfidence: Confidence;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  traderNotes?: string;
}
