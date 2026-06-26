import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationController } from './evaluation.controller';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';
import { PostTradeGradingService } from './post-trade-grading.service';
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

  beforeEach(async () => {
    getCurrentPlan = jest.fn().mockResolvedValue(null);
    savePlan = jest.fn().mockResolvedValue({ version: 2 });
    submitChecklist = jest.fn().mockResolvedValue({ checklistId: 'chk-1' });
    getPreEvalForTrade = jest.fn().mockResolvedValue({ tradeId: 't1' });
    getExecutionForTrade = jest.fn().mockResolvedValue({ tradeId: 't1' });
    getVerdictForTrade = jest.fn().mockResolvedValue({ verdict: 'good_trade' });

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
});
