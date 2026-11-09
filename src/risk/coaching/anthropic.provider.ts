import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoachingProvider, CoachingPromptParts } from './coaching.interface';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 400;

@Injectable()
export class AnthropicCoachingProvider implements CoachingProvider {
  readonly name = 'anthropic';
  private client: Anthropic | null = null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model =
      this.config.get<string>('ANTHROPIC_COACHING_MODEL') ?? DEFAULT_MODEL;
  }

  // Lazily constructed so a missing key never throws at DI time (the factory
  // only routes here when ANTHROPIC_API_KEY is set).
  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
      });
    }
    return this.client;
  }

  async generate(parts: CoachingPromptParts): Promise<string> {
    const response = await this.getClient().messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      // System prompt is static across requests → cache it (prompt caching).
      system: [
        {
          type: 'text',
          text: parts.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: parts.user }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    return textBlock?.text?.trim() ?? '';
  }
}
