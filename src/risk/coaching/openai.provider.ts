import OpenAI from 'openai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoachingProvider, CoachingPromptParts } from './coaching.interface';

const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = 400;

@Injectable()
export class OpenAiCoachingProvider implements CoachingProvider {
  readonly name = 'openai';
  private client: OpenAI | null = null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model =
      this.config.get<string>('OPENAI_COACHING_MODEL') ?? DEFAULT_MODEL;
  }

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.config.get<string>('OPENAI_API_KEY'),
      });
    }
    return this.client;
  }

  async generate(parts: CoachingPromptParts): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: this.model,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: parts.system },
        { role: 'user', content: parts.user },
      ],
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  }
}
