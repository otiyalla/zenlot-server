import { Job } from 'bullmq';
import {
  BehavioralSummaryJobData,
  EvaluationCoachingProcessor,
  GENERATE_BEHAVIORAL_SUMMARY_JOB,
  GENERATE_POST_TRADE_COACHING_JOB,
  GENERATE_PRE_TRADE_COACHING_JOB,
  PostTradeCoachingJobData,
  PreTradeCoachingJobData,
} from './coaching.processor';
import { EvaluationCoachingService } from './coaching.service';
import { PrismaService } from '../../prisma/prisma.service';
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
  verdict: 'bad_trade',
  lucky: true,
  processScore: 40,
  outcome: 'win',
  matrix: 'bad_process_win',
  coachingFocus: 'planAdherence',
};

const report: BehavioralReport = {
  userId: 'u1',
  generatedAt: '2026-06-26T00:00:00.000Z',
  tradesAnalyzed: 12,
  periodDays: 90,
  patterns: [],
  summary: null,
  topPriority: 'overtrading',
  stats: {
    avgProcessScore: 60,
    avgSetupQuality: 60,
    avgPlanAdherence: null,
    avgExecutionScore: 60,
    goodTradeRate: 50,
    luckyTradeRate: 10,
    winRate: 50,
    avgRMultiple: 1,
    bestProcessScore: 80,
    worstProcessScore: 30,
  },
};

function make(coachingResult: string | null) {
  const generateCoaching = jest.fn().mockResolvedValue(coachingResult);
  const preTradeUpdate = jest.fn().mockResolvedValue({});
  const verdictUpdate = jest.fn().mockResolvedValue({});
  const reportUpdate = jest.fn().mockResolvedValue({});

  const processor = new EvaluationCoachingProcessor(
    { generateCoaching } as unknown as EvaluationCoachingService,
    {
      preTradeEvaluation: { update: preTradeUpdate },
      tradeVerdict: { update: verdictUpdate },
      behavioralReport: { update: reportUpdate },
    } as unknown as PrismaService,
  );
  return {
    processor,
    generateCoaching,
    preTradeUpdate,
    verdictUpdate,
    reportUpdate,
  };
}

const preTradeJob = {
  name: GENERATE_PRE_TRADE_COACHING_JOB,
  data: {
    evaluationId: 'e1',
    language: 'en',
    evaluation,
  } as PreTradeCoachingJobData,
} as Job<PreTradeCoachingJobData>;

const postTradeJob = {
  name: GENERATE_POST_TRADE_COACHING_JOB,
  data: {
    verdictId: 'v1',
    language: 'en',
    verdict,
  } as PostTradeCoachingJobData,
} as Job<PostTradeCoachingJobData>;

const behavioralJob = {
  name: GENERATE_BEHAVIORAL_SUMMARY_JOB,
  data: { reportId: 'r1', language: 'en', report } as BehavioralSummaryJobData,
} as Job<BehavioralSummaryJobData>;

describe('EvaluationCoachingProcessor.process', () => {
  it('writes pre-trade coaching to pre_trade_evaluations.aiCoaching', async () => {
    const { processor, preTradeUpdate } = make('Proceed — solid setup.');
    await processor.process(preTradeJob);
    expect(preTradeUpdate).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: { aiCoaching: 'Proceed — solid setup.' },
    });
  });

  it('writes post-trade coaching to trade_verdicts.aiCoaching', async () => {
    const { processor, verdictUpdate } = make('You got lucky.');
    await processor.process(postTradeJob);
    expect(verdictUpdate).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { aiCoaching: 'You got lucky.' },
    });
  });

  it('writes behavioral summary to behavioral_reports.aiSummary', async () => {
    const { processor, reportUpdate } = make('You are overtrading.');
    await processor.process(behavioralJob);
    expect(reportUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { aiSummary: 'You are overtrading.' },
    });
  });

  it('leaves the column null (no update) when no coaching was produced', async () => {
    const { processor, preTradeUpdate, verdictUpdate, reportUpdate } =
      make(null);
    await processor.process(preTradeJob);
    await processor.process(postTradeJob);
    await processor.process(behavioralJob);
    expect(preTradeUpdate).not.toHaveBeenCalled();
    expect(verdictUpdate).not.toHaveBeenCalled();
    expect(reportUpdate).not.toHaveBeenCalled();
  });

  it('ignores unknown job names', async () => {
    const { processor, preTradeUpdate } = make('x');
    await processor.process({
      name: 'nonsense',
      data: {},
    } as unknown as Job<PreTradeCoachingJobData>);
    expect(preTradeUpdate).not.toHaveBeenCalled();
  });
});
