import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationController } from './evaluation.controller';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';
import { PostTradeGradingService } from './post-trade-grading.service';
import { BehavioralReportService } from './behavioral-report.service';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';
import { UpsertTradingPlanDto } from './dto/upsert-trading-plan.dto';

const req = {
  user: { id: 'u1', language: 'fr' },
} as unknown as AuthenticatedRequest;

describe('EvaluationController', () => {
  let controller: EvaluationController;
  let getCurrentPlan: jest.Mock;
  let savePlan: jest.Mock;
  let submitChecklist: jest.Mock;
  let getPreEvalForTrade: jest.Mock;
  let getExecutionForTrade: jest.Mock;
  let getVerdictForTrade: jest.Mock;
  let getOrGenerate: jest.Mock;
  let statsSummary: jest.Mock;

  beforeEach(async () => {
    getCurrentPlan = jest.fn().mockResolvedValue(null);
    savePlan = jest.fn().mockResolvedValue({ version: 2 });
    submitChecklist = jest.fn().mockResolvedValue({ checklistId: 'chk-1' });
    getPreEvalForTrade = jest.fn().mockResolvedValue({ tradeId: 't1' });
    getExecutionForTrade = jest.fn().mockResolvedValue({ tradeId: 't1' });
    getVerdictForTrade = jest.fn().mockResolvedValue({ verdict: 'good_trade' });
    getOrGenerate = jest.fn().mockResolvedValue({ id: 'report-1' });
    statsSummary = jest.fn().mockResolvedValue({ winRate: 0.5 });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EvaluationController],
      providers: [
        { provide: TradingPlanService, useValue: { getCurrentPlan, savePlan } },
        {
          provide: EvaluationService,
          useValue: { submitChecklist, getPreEvalForTrade },
        },
        {
          provide: PostTradeGradingService,
          useValue: { getExecutionForTrade, getVerdictForTrade },
        },
        {
          provide: BehavioralReportService,
          useValue: { getOrGenerate, statsSummary },
        },
      ],
    }).compile();

    controller = module.get<EvaluationController>(EvaluationController);
  });

  it('GET /plan delegates to the plan service with the user id', async () => {
    await controller.getPlan(req);
    expect(getCurrentPlan).toHaveBeenCalledWith('u1');
  });

  it('PUT /plan delegates to savePlan', async () => {
    const dto = {} as UpsertTradingPlanDto;
    await controller.savePlan(dto, req);
    expect(savePlan).toHaveBeenCalledWith('u1', dto);
  });

  it('POST /checklist passes the user id, dto, and language', async () => {
    const dto = {} as SubmitChecklistDto;
    await controller.submitChecklist(dto, req);
    expect(submitChecklist).toHaveBeenCalledWith('u1', dto, 'fr');
  });

  it('GET /trades/:tradeId/pre-eval delegates to getPreEvalForTrade', async () => {
    await controller.getPreEval('t1', req);
    expect(getPreEvalForTrade).toHaveBeenCalledWith('u1', 't1');
  });

  it('GET /trades/:tradeId/execution delegates to getExecutionForTrade', async () => {
    await controller.getExecution('t1', req);
    expect(getExecutionForTrade).toHaveBeenCalledWith('u1', 't1');
  });

  it('GET /trades/:tradeId/verdict delegates to getVerdictForTrade', async () => {
    await controller.getVerdict('t1', req);
    expect(getVerdictForTrade).toHaveBeenCalledWith('u1', 't1');
  });

  it('GET /behavioral-report returns the report and parses period_days', async () => {
    const reply = { status: jest.fn() } as never;
    const result = await controller.getBehavioralReport(req, reply, '30');
    expect(getOrGenerate).toHaveBeenCalledWith('u1', 30, 'fr');
    expect(result).toEqual({ id: 'report-1' });
  });

  it('GET /behavioral-report defaults period_days to 90', async () => {
    const reply = { status: jest.fn() } as never;
    await controller.getBehavioralReport(req, reply, undefined);
    expect(getOrGenerate).toHaveBeenCalledWith('u1', 90, 'fr');
  });

  it('GET /behavioral-report sets 204 + insufficient_data body when < 10 trades', async () => {
    getOrGenerate.mockResolvedValueOnce({
      insufficientData: true,
      tradesRequired: 10,
      tradesEvaluated: 3,
    });
    const status = jest.fn();
    const reply = { status } as never;
    const result = await controller.getBehavioralReport(req, reply, undefined);
    expect(status).toHaveBeenCalledWith(204);
    expect(result).toEqual({
      message: 'insufficient_data',
      tradesRequired: 10,
      tradesEvaluated: 3,
    });
  });

  it('GET /stats/summary delegates to statsSummary', async () => {
    await controller.getStatsSummary(req);
    expect(statsSummary).toHaveBeenCalledWith('u1');
  });
});
