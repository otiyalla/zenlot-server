import { GovernanceResult } from '../engine';
import { RiskCalculationView } from '../risk.mapper';

/** A built prompt: a (cacheable) system instruction and the per-request content. */
export interface CoachingPromptParts {
  system: string;
  user: string;
}

/** An AI coaching backend (Anthropic, OpenAI, …). Returns plain-language text. */
export interface CoachingProvider {
  readonly name: string;
  generate(parts: CoachingPromptParts): Promise<string>;
}

/** DI token for the failover-wired coaching provider. */
export const COACHING_PROVIDER = Symbol('COACHING_PROVIDER');

/** Everything the prompt builder needs to explain a result (numbers come from the engine). */
export interface CoachingContext {
  calculation: RiskCalculationView;
  governance: GovernanceResult;
  accountCurrency: string;
}
