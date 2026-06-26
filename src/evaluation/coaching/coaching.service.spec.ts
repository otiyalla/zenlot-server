import { EvaluationCoachingService } from './coaching.service';
import {
  CoachingProvider,
  PreTradeCoachingContext,
} from './coaching.interface';
import { PreTradeEvaluationResult } from '../engine';

const evaluation: PreTradeEvaluationResult = {
  tradeId: 't1',
  evaluatedAt: '2026-06-26T00:00:00.000Z',
  setupQuality: { total: 80, grade: 'B', breakdown: [], highProbability: true },
  planAdherence: null,
  recommendation: 'proceed',
  aiCoaching: null,
};

const context: PreTradeCoachingContext = { type: 'pre_trade', evaluation };

function makeService(provider: Partial<CoachingProvider>) {
  return new EvaluationCoachingService({
    name: 'mock',
    generate: jest.fn(),
    ...provider,
  } as CoachingProvider);
}

describe('EvaluationCoachingService', () => {
  it('returns trimmed provider text', async () => {
    const service = makeService({
      generate: jest.fn().mockResolvedValue('  Proceed — solid setup.  '),
    });
    await expect(service.generateCoaching(context, 'en')).resolves.toBe(
      'Proceed — solid setup.',
    );
  });

  it('returns null when the provider yields empty text', async () => {
    const service = makeService({
      generate: jest.fn().mockResolvedValue('   '),
    });
    await expect(service.generateCoaching(context, 'en')).resolves.toBeNull();
  });

  it('returns null (never throws) when the provider fails', async () => {
    const service = makeService({
      generate: jest.fn().mockRejectedValue(new Error('provider down')),
    });
    await expect(service.generateCoaching(context, 'en')).resolves.toBeNull();
  });

  it('passes the built prompt to the provider', async () => {
    const generate = jest.fn().mockResolvedValue('ok');
    const service = makeService({ generate });
    await service.generateCoaching(context, 'fr');
    const parts = generate.mock.calls[0][0];
    expect(parts.system).toContain('Répondez en français.');
    expect(parts.user).toContain('Recommendation: proceed');
  });
});
