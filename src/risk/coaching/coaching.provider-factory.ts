import { Logger } from '@nestjs/common';
import { CoachingProvider, CoachingPromptParts } from './coaching.interface';

export interface FailoverOptions {
  anthropic: CoachingProvider;
  openai: CoachingProvider;
  hasAnthropic: boolean;
  hasOpenai: boolean;
  logger?: Logger;
}

/**
 * Wraps the Anthropic (primary) and OpenAI (fallback) providers in a single
 * CoachingProvider. Mirrors the quote module's FX failover: try the primary,
 * and on error fall back to the secondary when it is configured. Throws only
 * when no provider is available or all configured providers fail.
 */
export function createFailoverCoachingProvider(
  opts: FailoverOptions,
): CoachingProvider {
  const { anthropic, openai, hasAnthropic, hasOpenai } = opts;
  const logger = opts.logger ?? new Logger('CoachingProvider');

  return {
    name: 'coaching',
    async generate(parts: CoachingPromptParts): Promise<string> {
      if (hasAnthropic) {
        try {
          return await anthropic.generate(parts);
        } catch (error) {
          if (!hasOpenai) throw error;
          logger.warn('Anthropic coaching failed. Falling back to OpenAI.');
        }
      }

      if (hasOpenai) {
        return openai.generate(parts);
      }

      throw new Error(
        'No coaching provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.',
      );
    },
  };
}
