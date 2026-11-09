/**
 * Phase 2 reuses the Phase 1 risk-coaching provider stack verbatim: the
 * Anthropic (primary) / OpenAI (fallback) providers and the failover wrapper
 * are provider-agnostic ({ system, user } → text), so there is no reason to
 * duplicate them. This module re-exports them under the evaluation namespace so
 * the evaluation module can wire its own DI token without importing from the
 * risk module's internals directly at every call site.
 */
export { AnthropicCoachingProvider } from '../../risk/coaching/anthropic.provider';
export { OpenAiCoachingProvider } from '../../risk/coaching/openai.provider';
export {
  createFailoverCoachingProvider,
  type FailoverOptions,
} from '../../risk/coaching/coaching.provider-factory';
