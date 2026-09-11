import { Queue } from 'bullmq';
import { EvaluationCoachingEnqueueService } from './coaching-enqueue.service';
import {
  GENERATE_BEHAVIORAL_SUMMARY_JOB,
  GENERATE_POST_TRADE_COACHING_JOB,
  GENERATE_PRE_TRADE_COACHING_JOB,
} from './coaching.processor';
import {
  BehavioralReport,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';

const evaluation: PreTradeEvaluationResult = {
  tradeId: 't1',
  evaluatedAt: '2026-06-26T00:00:00.000Z',
  setupQuality: { total: 80, grade: 'B', breakdown: [], highProbability: true },
  planAdherence: null,
  recommendation: 'proceed',
  aiCoaching: null,
};

const verdict: TradeVerdict = {
  verdict: 'good_trade',
  lucky: false,
  processScore: 85,
  outcome: 'win',
  matrix: 'good_process_win',
  coachingFocus: 'none',
};

const report = { userId: 'u1', patterns: [] } as unknown as BehavioralReport;

function make(add: jest.Mock) {
  return new EvaluationCoachingEnqueueService({ add } as unknown as Queue);
}

describe('EvaluationCoachingEnqueueService', () => {
  it('enqueues a pre-trade coaching job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueuePreTradeCoaching('e1', evaluation, 'en');
    expect(add).toHaveBeenCalledWith(
      GENERATE_PRE_TRADE_COACHING_JOB,
      { evaluationId: 'e1', evaluation, language: 'en' },
      { removeOnComplete: true },
    );
  });

  it('enqueues a post-trade coaching job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueuePostTradeCoaching('v1', verdict, 'fr');
    expect(add).toHaveBeenCalledWith(
      GENERATE_POST_TRADE_COACHING_JOB,
      { verdictId: 'v1', verdict, language: 'fr' },
      { removeOnComplete: true },
    );
  });

  it('enqueues a behavioral summary job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueueBehavioralSummary('r1', report, 'en');
    expect(add).toHaveBeenCalledWith(
      GENERATE_BEHAVIORAL_SUMMARY_JOB,
      { reportId: 'r1', report, language: 'en' },
      { removeOnComplete: true },
    );
  });

  it('is fire-and-forget: a queue failure never throws', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    await expect(
      make(add).enqueuePreTradeCoaching('e1', evaluation, 'en'),
    ).resolves.toBeUndefined();
  });
});
