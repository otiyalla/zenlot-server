import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { resolveLanguage } from '../engine';
import {
  COACHING_PROVIDER,
  CoachingContext,
  CoachingProvider,
} from './coaching.interface';
import { buildCoachingPrompt } from './coaching.prompt';

@Injectable()
export class CoachingService {
  private readonly logger = new Logger(CoachingService.name);

  constructor(
    @Inject(COACHING_PROVIDER) private readonly provider: CoachingProvider,
  ) {}

  /**
   * Generates a plain-language coaching explanation for an already-computed
   * result. Returns null (never throws) if every provider fails or none is
   * configured — coaching is a non-blocking enhancement.
   */
  async generateCoaching(
    context: CoachingContext,
    language: string,
  ): Promise<string | null> {
    const parts = buildCoachingPrompt(context, resolveLanguage(language));
    try {
      const text = await this.provider.generate(parts);
      return text && text.trim().length > 0 ? text.trim() : null;
    } catch (error) {
      this.logger.error('Coaching generation failed', error as Error);
      Sentry.captureException(error, {
        extra: { context: 'CoachingService.generateCoaching' },
      });
      return null;
    }
  }
}
