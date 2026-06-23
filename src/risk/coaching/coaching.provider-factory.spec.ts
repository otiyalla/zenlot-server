import { createFailoverCoachingProvider } from './coaching.provider-factory';
import { CoachingProvider } from './coaching.interface';

const parts = { system: 's', user: 'u' };

function provider(name: string, impl: jest.Mock): CoachingProvider {
  return { name, generate: impl };
}

describe('createFailoverCoachingProvider', () => {
  it('uses Anthropic when it succeeds', async () => {
    const a = jest.fn().mockResolvedValue('from-anthropic');
    const o = jest.fn();
    const p = createFailoverCoachingProvider({
      anthropic: provider('anthropic', a),
      openai: provider('openai', o),
      hasAnthropic: true,
      hasOpenai: true,
    });
    expect(await p.generate(parts)).toBe('from-anthropic');
    expect(o).not.toHaveBeenCalled();
  });

  it('falls back to OpenAI when Anthropic throws', async () => {
    const a = jest.fn().mockRejectedValue(new Error('anthropic down'));
    const o = jest.fn().mockResolvedValue('from-openai');
    const p = createFailoverCoachingProvider({
      anthropic: provider('anthropic', a),
      openai: provider('openai', o),
      hasAnthropic: true,
      hasOpenai: true,
    });
    expect(await p.generate(parts)).toBe('from-openai');
  });

  it('propagates the error when Anthropic fails and OpenAI is not configured', async () => {
    const a = jest.fn().mockRejectedValue(new Error('anthropic down'));
    const p = createFailoverCoachingProvider({
      anthropic: provider('anthropic', a),
      openai: provider('openai', jest.fn()),
      hasAnthropic: true,
      hasOpenai: false,
    });
    await expect(p.generate(parts)).rejects.toThrow('anthropic down');
  });

  it('uses OpenAI directly when Anthropic is not configured', async () => {
    const a = jest.fn();
    const o = jest.fn().mockResolvedValue('from-openai');
    const p = createFailoverCoachingProvider({
      anthropic: provider('anthropic', a),
      openai: provider('openai', o),
      hasAnthropic: false,
      hasOpenai: true,
    });
    expect(await p.generate(parts)).toBe('from-openai');
    expect(a).not.toHaveBeenCalled();
  });

  it('throws when no provider is configured', async () => {
    const p = createFailoverCoachingProvider({
      anthropic: provider('anthropic', jest.fn()),
      openai: provider('openai', jest.fn()),
      hasAnthropic: false,
      hasOpenai: false,
    });
    await expect(p.generate(parts)).rejects.toThrow(
      'No coaching provider configured',
    );
  });
});
