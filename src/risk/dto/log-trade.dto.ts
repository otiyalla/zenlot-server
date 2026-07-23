import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CalculateRiskDto } from './calculate-risk.dto';

/**
 * Body for logging a trade. Extends the sizing input with the override
 * acknowledgement. This is a journal, not an execution platform: a trade that
 * breaks a governance rule is never hard-blocked — the user confirms they
 * understand the rule and proceeds. How that confirmation is captured depends on
 * the user's `overrideMode`:
 *   - 'simple'   → a single `acknowledged: true`.
 *   - 'detailed' → `acknowledgedRules` must list every blocking rule.
 */
export class LogTradeDto extends CalculateRiskDto {
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Confirms logging the trade despite blocking rules (simple override mode).',
  })
  acknowledged?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiPropertyOptional({
    description:
      'Rule keys the user explicitly acknowledged (detailed override mode), e.g. ["maxPortfolioExposure"].',
  })
  acknowledgedRules?: string[];

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description:
      'Optional free-text note for why the user is overriding the rule(s).',
  })
  overrideReason?: string;
}
