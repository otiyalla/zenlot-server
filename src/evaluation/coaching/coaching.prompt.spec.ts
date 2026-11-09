import {
  buildBehavioralCoachingPrompt,
  buildCoachingPrompt,
  buildPostTradeCoachingPrompt,
  buildPreTradeCoachingPrompt,
} from './coaching.prompt';
import {
  BehavioralReport,
  PreTradeEvaluationResult,
  TradeVerdict,
} from '../engine';

const preTradeEval: PreTradeEvaluationResult = {
  tradeId: 't1',
  evaluatedAt: '2026-06-26T00:00:00.000Z',
  setupQuality: {
    total: 82,
    grade: 'B',
    breakdown: [
      { factor: 'momentum', points: 20, max: 25 },
      { factor: 'pattern', points: 18, max: 20 },
    ],
    highProbability: true,
  },
  planAdherence: {
    total: 55,
    grade: 'D',
    violations: [
      {
        rule: 'momentumAlignment',
        severity: 'major',
        message: 'Your plan requires momentum alignment — higher TF unclear',
      },
      {
        rule: 'stopPlacement',
        severity: 'minor',
        message: 'Stop placed arbitrarily, not at swing extreme',
      },
    ],
    ruleBreaker: true,
  },
  recommendation: 'reconsider',
  aiCoaching: null,
};

const luckyVerdict: TradeVerdict = {
  verdict: 'bad_trade',
  lucky: true,
  processScore: 38,
  outcome: 'win',
  matrix: 'bad_process_win',
  coachingFocus: 'planAdherence',
};

const goodProcessLossVerdict: TradeVerdict = {
  verdict: 'good_trade',
  lucky: false,
  processScore: 88,
  outcome: 'loss',
  matrix: 'good_process_loss',
  coachingFocus: 'none',
};

const behavioralReport: BehavioralReport = {
  userId: 'u1',
  generatedAt: '2026-06-26T00:00:00.000Z',
  tradesAnalyzed: 24,
  periodDays: 90,
  patterns: [
    {
      type: 'stop_widening',
      severity: 'critical',
      confidence: 0.8,
      sampleSize: 6,
      totalTrades: 24,
      evidence: ['t1', 't2'],
      metric: 'widened stop on 6 of 24 trades',
    },
    {
      type: 'early_exit',
      severity: 'warning',
      confidence: 0.5,
      sampleSize: 4,
      totalTrades: 24,
      evidence: ['t3'],
      metric: 'exited before target on 4 trades',
    },
  ],
  summary: null,
  topPriority: 'stop_widening',
  stats: {
    avgProcessScore: 71,
    avgSetupQuality: 75,
    avgPlanAdherence: 68,
    avgExecutionScore: 70,
    goodTradeRate: 62,
    luckyTradeRate: 12,
    winRate: 55,
    avgRMultiple: 1.4,
    bestProcessScore: 95,
    worstProcessScore: 40,
  },
};

const MONEY_PATTERN = /\$|€|£|profit|\bP&L\b|dollar/i;

describe('Phase 2 coaching prompts', () => {
  describe('pre-trade', () => {
    it('leads with the recommendation and word-limit guidance', () => {
      const { system, user } = buildPreTradeCoachingPrompt(
        { type: 'pre_trade', evaluation: preTradeEval },
        'en',
      );
      expect(system).toContain('under 100 words');
      expect(system).toContain('referee, not a judge');
      expect(system.toLowerCase()).toContain('recommendation');
      expect(user).toContain('Recommendation: reconsider');
    });

    it('names plan violations specifically', () => {
      const { user } = buildPreTradeCoachingPrompt(
        { type: 'pre_trade', evaluation: preTradeEval },
        'en',
      );
      expect(user).toContain('momentumAlignment');
      expect(user).toContain('major');
    });

    it('never references P&L or dollar amounts', () => {
      const { system, user } = buildPreTradeCoachingPrompt(
        { type: 'pre_trade', evaluation: preTradeEval },
        'en',
      );
      // The system rule may name P&L to forbid it; the user content must not.
      expect(user).not.toMatch(MONEY_PATTERN);
      expect(system).toContain('NEVER reference P&L');
    });

    it('handles a missing trading plan without violations', () => {
      const { user } = buildPreTradeCoachingPrompt(
        {
          type: 'pre_trade',
          evaluation: { ...preTradeEval, planAdherence: null },
        },
        'en',
      );
      expect(user).toContain('not scored');
    });
  });

  describe('post-trade', () => {
    it('leads with the lucky flag when lucky=true', () => {
      const { system, user } = buildPostTradeCoachingPrompt(
        { type: 'post_trade', verdict: luckyVerdict },
        'en',
      );
      expect(system).toContain('LEAD with that');
      expect(system.toLowerCase()).toContain('never soften');
      expect(user).toContain('Lucky flag: true');
      expect(system).toContain('under 120 words');
    });

    it('reinforces a good_process_loss', () => {
      const { system, user } = buildPostTradeCoachingPrompt(
        { type: 'post_trade', verdict: goodProcessLossVerdict },
        'en',
      );
      expect(system).toContain('good_process_loss');
      expect(system.toLowerCase()).toContain('variance');
      expect(user).toContain('good_process_loss');
    });

    it('uses R-multiples / process scores, never P&L amounts', () => {
      const { user } = buildPostTradeCoachingPrompt(
        { type: 'post_trade', verdict: luckyVerdict },
        'en',
      );
      expect(user).toContain('Process score: 38');
      expect(user).not.toMatch(MONEY_PATTERN);
    });
  });

  describe('behavioral', () => {
    it('leads with the most critical pattern and has the 200-word cap', () => {
      const { system, user } = buildBehavioralCoachingPrompt(
        { type: 'behavioral', report: behavioralReport },
        'en',
      );
      expect(system).toContain('most critical pattern first');
      expect(system).toContain('200 words');
      expect(user).toContain(
        'Most critical pattern (lead with this): stop_widening',
      );
    });

    it('includes actual metrics, never P&L', () => {
      const { user } = buildBehavioralCoachingPrompt(
        { type: 'behavioral', report: behavioralReport },
        'en',
      );
      expect(user).toContain('avg R-multiple 1.4');
      expect(user).toContain('widened stop on 6 of 24 trades');
      expect(user).not.toMatch(MONEY_PATTERN);
    });
  });

  describe('language selection', () => {
    it('selects EN vs FR system prompts for every coaching type', () => {
      expect(
        buildPreTradeCoachingPrompt(
          { type: 'pre_trade', evaluation: preTradeEval },
          'en',
        ).system,
      ).toContain('Respond in English.');
      expect(
        buildPreTradeCoachingPrompt(
          { type: 'pre_trade', evaluation: preTradeEval },
          'fr',
        ).system,
      ).toContain('Répondez en français.');

      expect(
        buildPostTradeCoachingPrompt(
          { type: 'post_trade', verdict: luckyVerdict },
          'fr',
        ).system,
      ).toContain('Répondez en français.');

      expect(
        buildBehavioralCoachingPrompt(
          { type: 'behavioral', report: behavioralReport },
          'fr',
        ).system,
      ).toContain('Répondez en français.');
    });
  });

  describe('buildCoachingPrompt dispatcher', () => {
    it('routes each context type to its builder', () => {
      expect(
        buildCoachingPrompt(
          { type: 'pre_trade', evaluation: preTradeEval },
          'en',
        ).user,
      ).toContain('Recommendation:');
      expect(
        buildCoachingPrompt({ type: 'post_trade', verdict: luckyVerdict }, 'en')
          .user,
      ).toContain('Verdict:');
      expect(
        buildCoachingPrompt(
          { type: 'behavioral', report: behavioralReport },
          'en',
        ).user,
      ).toContain('Trades analyzed:');
    });
  });
});
