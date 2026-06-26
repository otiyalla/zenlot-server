import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements/entitlements.service';
import { EvaluationController } from './evaluation.controller';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';

/**
 * Phase 2 Evaluation module (Increment 1 — pre-trade evaluation API + soft-gate).
 *
 * The deterministic scoring engine lives in ./engine as pure functions (no DI).
 * This module wires the persistence services + controller that orchestrate the
 * engine, and exports EvaluationService so the live trade-logging flow
 * (RiskModule's TradeLogService) can link/skip checklists on trade creation.
 *
 * AI coaching is intentionally absent: a later increment adds the async
 * pre-trade coaching queue (see the commented hook in EvaluationService).
 */
@Module({
  controllers: [EvaluationController],
  providers: [EntitlementsService, TradingPlanService, EvaluationService],
  exports: [EntitlementsService, EvaluationService],
})
export class EvaluationModule {}
