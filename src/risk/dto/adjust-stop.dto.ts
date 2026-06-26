import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for PATCH /risk/trades/:id/stop (spec Section 13.2).
 *
 * `reason` is REQUIRED: every stop adjustment must be justified so the execution
 * grader (and the behavioral stop_widening detector) has an auditable record of
 * why a stop moved. A widened stop with no reason is exactly the impulsive
 * behavior the journal is meant to surface, so we force the trader to name it.
 */
export class AdjustStopDto {
  @IsNumber()
  @IsPositive()
  @ApiProperty({ description: 'The new stop-loss price for the trade.' })
  stopPrice: number;

  @IsString()
  @MinLength(1)
  @ApiProperty({
    description:
      'Why the stop was adjusted. Required — every adjustment is logged.',
  })
  reason: string;
}
