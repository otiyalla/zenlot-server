import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { RiskController } from './risk.controller';
import { RiskProfileService } from './risk-profile.service';
import { RiskCalculationService } from './risk-calculation.service';
import { PortfolioService } from './portfolio.service';
import { DrawdownService } from './drawdown.service';
import { RateResolverService } from './rate-resolver.service';
import { TradeLogService } from './trade-log.service';
import { ViolationsService } from './violations.service';
import {
  DRAWDOWN_RESET_QUEUE,
  DrawdownResetProcessor,
} from './drawdown-reset.processor';
import {
  COACHING_QUEUE,
  CoachingProcessor,
} from './coaching/coaching.processor';
import { CoachingService } from './coaching/coaching.service';
import { AnthropicCoachingProvider } from './coaching/anthropic.provider';
import { OpenAiCoachingProvider } from './coaching/openai.provider';
import {
  COACHING_PROVIDER,
  CoachingProvider,
} from './coaching/coaching.interface';
import { createFailoverCoachingProvider } from './coaching/coaching.provider-factory';
import { AuditModule } from '../audit/audit.module';
import { QuoteModule } from '../quote/quote.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EvaluationModule } from '../evaluation/evaluation.module';

@Module({
  imports: [
    AuditModule,
    QuoteModule,
    NotificationsModule,
    EvaluationModule,
    BullModule.registerQueue(
      { name: DRAWDOWN_RESET_QUEUE },
      { name: COACHING_QUEUE },
    ),
  ],
  controllers: [RiskController],
  providers: [
    RiskProfileService,
    RiskCalculationService,
    PortfolioService,
    DrawdownService,
    RateResolverService,
    TradeLogService,
    ViolationsService,
    DrawdownResetProcessor,
    CoachingService,
    CoachingProcessor,
    AnthropicCoachingProvider,
    OpenAiCoachingProvider,
    {
      provide: COACHING_PROVIDER,
      inject: [
        ConfigService,
        AnthropicCoachingProvider,
        OpenAiCoachingProvider,
      ],
      useFactory: (
        config: ConfigService,
        anthropic: AnthropicCoachingProvider,
        openai: OpenAiCoachingProvider,
      ): CoachingProvider =>
        createFailoverCoachingProvider({
          anthropic,
          openai,
          hasAnthropic: !!config.get<string>('ANTHROPIC_API_KEY'),
          hasOpenai: !!config.get<string>('OPENAI_API_KEY'),
          logger: new Logger('CoachingProvider'),
        }),
    },
  ],
  exports: [
    RiskProfileService,
    RiskCalculationService,
    PortfolioService,
    DrawdownService,
    TradeLogService,
  ],
})
export class RiskModule {}
