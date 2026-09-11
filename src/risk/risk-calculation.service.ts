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
  validateActiveTradeGeometry as validateEngineActiveTradeGeometry,
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
    const { calculation, view, profile } = await this.compute(
      userId,
      accountCurrency,
      dto,
      'prospective',
    );
    const portfolio = await this.portfolioService.getSnapshot(userId);
    const drawdown = await this.drawdownService.getState(userId);
    const governance = evaluateGovernance(
      calculation,
      portfolio,
      drawdown,
      profile,
      resolveLanguage(language),
    );

    return { calculation: view, governance };
  }

  /**
   * Recomputes derived fields for an already-open position. Unlike prospective
   * sizing, an active position may move its stop to/beyond entry to lock profit.
   * Governance is intentionally not re-run because this does not add a position
   * to the portfolio.
   */
  async calculateActiveTrade(
    userId: string,
    accountCurrency: string,
    dto: CalculateRiskDto,
  ): Promise<RiskCalculationView> {
    const { view } = await this.compute(userId, accountCurrency, dto, 'active');
    return view;
  }

  validateActiveTradeGeometry(dto: CalculateRiskDto): void {
    try {
      validateEngineActiveTradeGeometry({
        direction: executionToDirection(dto.execution),
        entryPrice: dto.entry,
        stopPrice: dto.stopPrice,
        targetPrice: dto.targetPrice ?? null,
      });
    } catch (error) {
      if (error instanceof RiskCalculationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async compute(
    userId: string,
    accountCurrency: string,
    dto: CalculateRiskDto,
    context: 'prospective' | 'active',
  ) {
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
      calculation = computeRiskCalculation(
        {
          pair: dto.symbol.toUpperCase(),
          direction,
          entryPrice: dto.entry,
          stopPrice: dto.stopPrice,
          targetPrice: dto.targetPrice ?? null,
          accountBalance: profile.accountBalance,
          maxRiskPct: profile.maxRiskPerTradePct,
          exchangeRate,
          lot: dto.lot ?? null,
        },
        { context },
      );
    } catch (error) {
      if (error instanceof RiskCalculationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    return {
      calculation,
      view: toRiskCalculationView(calculation, exchangeRate),
      profile,
    };
  }
}
