import { BadRequestException, Injectable } from '@nestjs/common';
import { RiskProfileService } from './risk-profile.service';
import { PortfolioService } from './portfolio.service';
import { DrawdownService } from './drawdown.service';
import { RateResolverService } from './rate-resolver.service';
import {
  computeRiskCalculation,
  evaluateGovernance,
  GovernanceResult,
  RiskCalculation,
  RiskCalculationError,
  resolveLanguage,
} from './engine';
import {
  executionToDirection,
  RiskCalculationView,
  toRiskCalculationView,
} from './risk.mapper';
import { CalculateRiskDto } from './dto/calculate-risk.dto';

export interface CalculateRiskResult {
  calculation: RiskCalculationView;
  governance: GovernanceResult;
}

@Injectable()
export class RiskCalculationService {
  constructor(
    private readonly rateResolver: RateResolverService,
    private readonly riskProfileService: RiskProfileService,
    private readonly portfolioService: PortfolioService,
    private readonly drawdownService: DrawdownService,
  ) {}

  /**
   * Sizes a prospective trade and runs the deterministic governance check
   * against the user's live portfolio + drawdown state. AI coaching is absent
   * here (added async in a later PR). Governance messages are localized to the
   * user's language.
   */
  async calculate(
    userId: string,
    accountCurrency: string,
    dto: CalculateRiskDto,
    language: string = 'en',
  ): Promise<CalculateRiskResult> {
    const profile = await this.riskProfileService.getProfile(
      userId,
      accountCurrency,
    );
    if (!(profile.accountBalance > 0)) {
      throw new BadRequestException(
        'Set your account balance in your risk profile before calculating position size.',
      );
    }

    const direction = executionToDirection(dto.execution);
    const exchangeRate = await this.rateResolver.resolveExchangeRate(
      dto.symbol,
      accountCurrency,
    );

    let calculation: RiskCalculation;
    try {
      calculation = computeRiskCalculation({
        pair: dto.symbol.toUpperCase(),
        direction,
        entryPrice: dto.entry,
        stopPrice: dto.stopPrice,
        targetPrice: dto.targetPrice ?? null,
        accountBalance: profile.accountBalance,
        maxRiskPct: profile.maxRiskPerTradePct,
        exchangeRate,
        lot: dto.lot ?? null,
      });
    } catch (error) {
      if (error instanceof RiskCalculationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const portfolio = await this.portfolioService.getSnapshot(userId);
    const drawdown = await this.drawdownService.getState(userId);
    // RiskProfileResponse is structurally a superset of the engine's RiskProfile.
    const governance = evaluateGovernance(
      calculation,
      portfolio,
      drawdown,
      profile,
      resolveLanguage(language),
    );

    return {
      calculation: toRiskCalculationView(calculation, exchangeRate),
      governance,
    };
  }
}
