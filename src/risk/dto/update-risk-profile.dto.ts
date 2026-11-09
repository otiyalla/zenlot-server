import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Partial update of a user's risk governance profile.
 *
 * All fields are optional so the client can patch a single value. Bounds are
 * "sensible limits" guardrails (spec Section 8 — PUT /profile): percentages are
 * capped so a typo cannot disable governance entirely. The UI separately warns
 * when a value exceeds the professional standard (e.g. risk per trade > 3%).
 */
export class UpdateRiskProfileDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Max capital exposure per trade (% of balance). Default 1.0',
  })
  maxRiskPerTradePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Max total exposure across all open trades (%). Default 3.0',
  })
  maxPortfolioExposurePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Daily drawdown circuit breaker (%). Default 5.0',
  })
  maxDailyDrawdownPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Weekly drawdown circuit breaker (%). Default 8.0',
  })
  maxWeeklyDrawdownPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Monthly drawdown circuit breaker (%). Default 10.0',
  })
  maxMonthlyDrawdownPct?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Max number of concurrent open trades. Default 5',
  })
  maxOpenTrades?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @ApiPropertyOptional({
    description:
      'Max combined exposure across correlated pairs (%). Default 6.0',
  })
  maxCorrelatedExposure?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000_000)
  @ApiPropertyOptional({
    description:
      'Current account equity in the account currency. Bounded 0 – 1e12 as a ' +
      'sanity guardrail (a matching DB CHECK enforces the upper bound).',
  })
  accountBalance?: number;

  @IsOptional()
  @IsIn(['simple', 'detailed'])
  @ApiPropertyOptional({
    description:
      "How rule-override confirmation is presented: 'simple' (one tap) or " +
      "'detailed' (acknowledge each broken rule). Default 'simple'.",
  })
  overrideMode?: 'simple' | 'detailed';
}
