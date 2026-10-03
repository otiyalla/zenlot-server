import { Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EntitlementsService } from './entitlements/entitlements.service';
import { EvaluationController } from './evaluation.controller';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';
import { PostTradeGradingService } from './post-trade-grading.service';
import { SetupPatternService } from './setup-pattern.service';
import { BehavioralReportService } from './behavioral-report.service';
import { WeeklyBehavioralService } from './weekly-behavioral.service';
import {
  WEEKLY_BEHAVIORAL_QUEUE,
  WeeklyBehavioralProcessor,
} from './weekly-behavioral.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  EVALUATION_COACHING_QUEUE,
  EvaluationCoachingProcessor,
} from './coaching/coaching.processor';
import { EvaluationCoachingService } from './coaching/coaching.service';
import { EvaluationCoachingEnqueueService } from './coaching/coaching-enqueue.service';
import {
  CoachingProvider,
  EVALUATION_COACHING_PROVIDER,
} from './coaching/coaching.interface';
import {
  AnthropicCoachingProvider,
  createFailoverCoachingProvider,
  OpenAiCoachingProvider,
} from './coaching/coaching.provider-factory';

/**
 * Phase 2 Evaluation module.
 *
 * The deterministic scoring engine lives in ./engine as pure functions (no DI).
 * This module wires the persistence services + controller that orchestrate the
 * engine, and exports EvaluationService so the live trade-logging flow
 * (RiskModule's TradeLogService) can link/skip checklists on trade creation.
 *
 * AI coaching (spec Section 9) is the async, non-blocking layer in ./coaching:
 * a BullMQ queue + processor populates the ai_coaching / ai_summary columns,
 * reusing the Phase 1 risk-coaching Anthropic/OpenAI providers + failover.
 * EvaluationCoachingEnqueueService is exported so Increments 2 & 3 can enqueue
 * post-trade and behavioral coaching.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: EVALUATION_COACHING_QUEUE }),
    BullModule.registerQueue({ name: WEEKLY_BEHAVIORAL_QUEUE }),
    NotificationsModule,
  ],
  controllers: [EvaluationController],
  providers: [
    EntitlementsService,
    TradingPlanService,
    EvaluationService,
    SetupPatternService,
    PostTradeGradingService,
    BehavioralReportService,
    WeeklyBehavioralService,
    WeeklyBehavioralProcessor,
    EvaluationCoachingService,
    EvaluationCoachingProcessor,
    EvaluationCoachingEnqueueService,
    AnthropicCoachingProvider,
    OpenAiCoachingProvider,
    {
      provide: EVALUATION_COACHING_PROVIDER,
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
          logger: new Logger('EvaluationCoachingProvider'),
        }),
    },
  ],
  exports: [
    EntitlementsService,
    EvaluationService,
    SetupPatternService,
    PostTradeGradingService,
    BehavioralReportService,
    EvaluationCoachingEnqueueService,
  ],
})
export class EvaluationModule {}
