import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { resolveLanguage } from '../engine';
import {
  CoachingContext,
  CoachingProvider,
  EVALUATION_COACHING_PROVIDER,
} from './coaching.interface';
import { buildCoachingPrompt } from './coaching.prompt';

/**
 * Generates Phase 2 plain-language coaching for an already-computed evaluation
 * result (pre-trade evaluation, trade verdict, or behavioral report).
 *
 * Mirrors the Phase 1 risk CoachingService: it NEVER throws — it returns null if
 * every provider fails or none is configured, because coaching is a
 * non-blocking enhancement and the client renders a null column gracefully.
 */
@Injectable()
export class EvaluationCoachingService {
  private readonly logger = new Logger(EvaluationCoachingService.name);

  constructor(
    @Inject(EVALUATION_COACHING_PROVIDER)
    private readonly provider: CoachingProvider,
  ) {}

  async generateCoaching(
    context: CoachingContext,
    language: string,
  ): Promise<string | null> {
    const parts = buildCoachingPrompt(context, resolveLanguage(language));
    try {
      const text = await this.provider.generate(parts);
      return text && text.trim().length > 0 ? text.trim() : null;
    } catch (error) {
      this.logger.error(
        `Coaching generation failed (${context.type})`,
        error as Error,
      );
      Sentry.captureException(error, {
        extra: { context: 'EvaluationCoachingService.generateCoaching' },
      });
      return null;
    }
  }
}
