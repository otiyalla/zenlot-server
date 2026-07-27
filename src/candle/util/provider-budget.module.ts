import { Global, Module } from '@nestjs/common';
import { ProviderBudget } from './provider-budget';

/**
 * Owns the process-wide upstream budget state. TwelveData quote and candle
 * requests use the same API key and therefore must share the same quota.
 */
@Global()
@Module({
  providers: [ProviderBudget],
  exports: [ProviderBudget],
})
export class ProviderBudgetModule {}
