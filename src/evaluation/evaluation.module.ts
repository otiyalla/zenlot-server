import { Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements/entitlements.service';

/**
 * Phase 2 Evaluation module (Increment 0 — engine + seams only).
 *
 * The deterministic engine lives in ./engine as pure functions (no DI needed).
 * Controllers, persistence services, and the async AI coaching layer arrive in
 * later increments. For now this wires only the providers that other modules /
 * future increments will consume — chiefly the EntitlementsService seam.
 */
@Module({
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class EvaluationModule {}
