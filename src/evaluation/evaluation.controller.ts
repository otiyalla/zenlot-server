import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';
import { PostTradeGradingService } from './post-trade-grading.service';
import { UpsertTradingPlanDto } from './dto/upsert-trading-plan.dto';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';

/**
 * Phase 2 Trade Evaluation API (spec Section 11).
 *
 * NOTE on the route prefix: the spec writes endpoints as `/api/v1/evaluation/*`,
 * but this codebase has NO global `api/v1` prefix — every existing controller is
 * mounted bare (`/risk`, `/trade`, …). Phase 1 made the same call. To stay
 * consistent (and avoid a global prefix change that would move ALL routes and
 * break existing clients/tests) these endpoints are mounted at `/evaluation/*`.
 */
@ApiTags('Evaluation')
@ApiSecurity('access-token')
@Controller('evaluation')
export class EvaluationController {
  constructor(
    private readonly tradingPlanService: TradingPlanService,
    private readonly evaluationService: EvaluationService,
    private readonly postTradeGrading: PostTradeGradingService,
  ) {}

  @Get('plan')
  @ApiOperation({
    summary: "Get the authenticated user's current trading plan",
  })
  @ApiResponse({
    status: 200,
    description: 'Current trading plan, or null if none defined.',
  })
  getPlan(@Request() req: AuthenticatedRequest) {
    return this.tradingPlanService.getCurrentPlan(req.user.id);
  }

  @Put('plan')
  @ApiOperation({
    summary:
      'Save the trading plan. Creates a new version and marks the previous ' +
      'version not-current; history is preserved.',
  })
  @ApiResponse({ status: 200, description: 'The newly saved plan version.' })
  savePlan(
    @Body() dto: UpsertTradingPlanDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.tradingPlanService.savePlan(req.user.id, dto);
  }

  @Post('checklist')
  @ApiOperation({
    summary:
      'Submit a pre-trade checklist (no tradeId required yet) and get the ' +
      'computed pre-trade evaluation. AI coaching is null on this response.',
  })
  @ApiResponse({
    status: 201,
    description:
      'PreTradeEvaluationResult with the persisted checklistId. tradeId is ' +
      'null until the trade is logged with this checklistId.',
  })
  submitChecklist(
    @Body() dto: SubmitChecklistDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.evaluationService.submitChecklist(
      req.user.id,
      dto,
      req.user.language,
    );
  }

  @Get('trades/:tradeId/pre-eval')
  @ApiOperation({
    summary: 'Get the pre-trade evaluation linked to a trade',
  })
  @ApiParam({ name: 'tradeId', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'The pre-trade evaluation.' })
  @ApiResponse({
    status: 404,
    description: 'No pre-trade evaluation found for this trade.',
  })
  getPreEval(
    @Param('tradeId') tradeId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.evaluationService.getPreEvalForTrade(req.user.id, tradeId);
  }

  @Get('trades/:tradeId/execution')
  @ApiOperation({
    summary:
      'Get the post-trade execution grade for a trade (populated after close)',
  })
  @ApiParam({ name: 'tradeId', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'The execution grade.' })
  @ApiResponse({
    status: 404,
    description: 'The trade has not been graded yet.',
  })
  getExecution(
    @Param('tradeId') tradeId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.postTradeGrading.getExecutionForTrade(req.user.id, tradeId);
  }

  @Get('trades/:tradeId/verdict')
  @ApiOperation({
    summary:
      'Get the process-vs-outcome verdict for a trade (populated after close)',
  })
  @ApiParam({ name: 'tradeId', required: true, description: 'Trade id' })
  @ApiResponse({
    status: 200,
    description: 'The trade verdict. ai_coaching may be null until async fill.',
  })
  @ApiResponse({ status: 404, description: 'No verdict for this trade.' })
  getVerdict(
    @Param('tradeId') tradeId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.postTradeGrading.getVerdictForTrade(req.user.id, tradeId);
  }
}
