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

function make(add: jest.Mock, getJob: jest.Mock = jest.fn().mockResolvedValue(null)) {
  return new EvaluationCoachingEnqueueService({
    add,
    getJob,
  } as unknown as Queue);
}

const COOLDOWN_MS = 15 * 60 * 1_000;

/** A retained job as BullMQ hands it back from `getJob`. */
function retainedJob(state: string, finishedOn: number) {
  return {
    getState: jest.fn().mockResolvedValue(state),
    finishedOn,
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

describe('EvaluationCoachingEnqueueService', () => {
  it('enqueues a pre-trade coaching job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueuePreTradeCoaching('e1', evaluation, 'en');
    expect(add).toHaveBeenCalledWith(
      GENERATE_PRE_TRADE_COACHING_JOB,
      { evaluationId: 'e1', evaluation, language: 'en' },
      {
        jobId: `${GENERATE_PRE_TRADE_COACHING_JOB}-e1`,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: { age: 15 * 60 },
      },
    );
  });

  it('enqueues a post-trade coaching job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueuePostTradeCoaching('v1', verdict, 'fr');
    expect(add).toHaveBeenCalledWith(
      GENERATE_POST_TRADE_COACHING_JOB,
      { verdictId: 'v1', verdict, language: 'fr' },
      {
        jobId: `${GENERATE_POST_TRADE_COACHING_JOB}-v1`,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: { age: 15 * 60 },
      },
    );
  });

  it('enqueues a behavioral summary job', async () => {
    const add = jest.fn().mockResolvedValue({});
    await make(add).enqueueBehavioralSummary('r1', report, 'en');
    expect(add).toHaveBeenCalledWith(
      GENERATE_BEHAVIORAL_SUMMARY_JOB,
      { reportId: 'r1', report, language: 'en' },
      {
        jobId: `${GENERATE_BEHAVIORAL_SUMMARY_JOB}-r1`,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: { age: 15 * 60 },
      },
    );
  });

  it('is fire-and-forget: a queue failure never throws', async () => {
    const add = jest.fn().mockRejectedValue(new Error('redis down'));
    await expect(
      make(add).enqueuePreTradeCoaching('e1', evaluation, 'en'),
    ).resolves.toBeUndefined();
  });

  describe('a previously failed job', () => {
    const jobId = `${GENERATE_BEHAVIORAL_SUMMARY_JOB}-r1`;

    it('is dropped once past the cooldown so the add creates fresh work', async () => {
      // BullMQ applies removeOnFail age lazily (only as another job finishes),
      // so on a quiet queue the failure outlives its age and silently swallows
      // every same-id re-enqueue. Recovery must not depend on queue traffic.
      const job = retainedJob('failed', Date.now() - COOLDOWN_MS - 1_000);
      const add = jest.fn().mockResolvedValue({});
      const getJob = jest.fn().mockResolvedValue(job);

      await make(add, getJob).enqueueBehavioralSummary('r1', report, 'en');

      expect(getJob).toHaveBeenCalledWith(jobId);
      expect(job.remove).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(1);
    });

    it('is kept while still inside the cooldown', async () => {
      const job = retainedJob('failed', Date.now() - 1_000);
      const add = jest.fn().mockResolvedValue({});

      await make(add, jest.fn().mockResolvedValue(job)).enqueueBehavioralSummary(
        'r1',
        report,
        'en',
      );

      // The add still runs; BullMQ drops it as a duplicate id, which is what
      // keeps reads during the cooldown from calling the provider again.
      expect(job.remove).not.toHaveBeenCalled();
    });

    it('leaves a job that is still queued or running alone', async () => {
      const job = retainedJob('active', Date.now() - COOLDOWN_MS - 1_000);
      const add = jest.fn().mockResolvedValue({});

      await make(add, jest.fn().mockResolvedValue(job)).enqueueBehavioralSummary(
        'r1',
        report,
        'en',
      );

      expect(job.remove).not.toHaveBeenCalled();
    });
  });
});
