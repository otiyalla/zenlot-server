import {
  BehavioralReport,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';

/**
 * Phase 2 AI coaching contracts (spec Section 9).
 *
 * The deterministic engine has already produced every score, grade, verdict and
 * pattern by the time these run. Claude only ever translates those finished
 * numbers into plain-language coaching — it never recomputes or overrides a
 * score (spec Principle 5: "AI coaches, code scores").
 *
 * The provider contract ({ system, user } → text) is intentionally identical to
 * the Phase 1 risk-coaching provider so the same generic Anthropic/OpenAI
 * providers + failover factory can back both layers — see
 * coaching.provider-factory.ts in this directory, which re-exports them.
 */

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

/** DI token for the failover-wired evaluation coaching provider. */
export const EVALUATION_COACHING_PROVIDER = Symbol(
  'EVALUATION_COACHING_PROVIDER',
);

/** The three async coaching calls Phase 2 makes (spec Section 9). */
export type CoachingType = 'pre_trade' | 'post_trade' | 'behavioral';

/** Pre-trade coaching input — a finished PreTradeEvaluationResult (spec 9.1). */
export interface PreTradeCoachingContext {
  type: 'pre_trade';
  evaluation: PreTradeEvaluationResult;
}

/** Post-trade coaching input — a finished TradeVerdict (spec 9.1). */
export interface PostTradeCoachingContext {
  type: 'post_trade';
  verdict: TradeVerdict;
}

/** Behavioral summary input — a finished BehavioralReport (spec 9.2). */
export interface BehavioralCoachingContext {
  type: 'behavioral';
  report: BehavioralReport;
}

export type CoachingContext =
  | PreTradeCoachingContext
  | PostTradeCoachingContext
  | BehavioralCoachingContext;
