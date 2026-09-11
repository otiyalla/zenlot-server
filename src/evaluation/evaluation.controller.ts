import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';
import { TradingPlanService } from './trading-plan.service';
import { EvaluationService } from './evaluation.service';
import { PostTradeGradingService } from './post-trade-grading.service';
import {
  BehavioralReportService,
  isInsufficientData,
} from './behavioral-report.service';
import { UpsertTradingPlanDto } from './dto/upsert-trading-plan.dto';
import { SubmitChecklistDto } from './dto/submit-checklist.dto';
import { SetupPatternService } from './setup-pattern.service';
import { DEFAULT_PERIOD_DAYS } from './engine';

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
    private readonly behavioralReports: BehavioralReportService,
    private readonly setupPatterns: SetupPatternService,
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

  @Get('setup-patterns')
  @ApiOperation({
    summary:
      "The authenticated user's custom setup pattern names, most-used first",
    description:
      'Feeds the autocomplete under the checklist\'s "Other" pattern option. ' +
      'The library is capped per user, so the whole list is returned and the ' +
      'client filters it locally as the trader types.',
  })
  @ApiResponse({
    status: 200,
    description: 'Custom pattern names with their usage counts.',
  })
  getSetupPatterns(@Request() req: AuthenticatedRequest) {
    return this.setupPatterns.list(req.user.id);
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

  @Get('evaluations/:evaluationId')
  @ApiOperation({
    summary:
      'Get a pre-trade evaluation by id (poll for async AI coaching before the trade is logged)',
  })
  @ApiParam({
    name: 'evaluationId',
    required: true,
    description: 'Evaluation id',
  })
  @ApiResponse({ status: 200, description: 'The pre-trade evaluation.' })
  @ApiResponse({ status: 404, description: 'No pre-trade evaluation found.' })
  getEvaluationById(
    @Param('evaluationId') evaluationId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.evaluationService.getEvalById(req.user.id, evaluationId);
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

  @Get('behavioral-report')
  @ApiOperation({
    summary:
      'Latest behavioral-intelligence report, regenerating if stale. Returns ' +
      '204 with an insufficient_data body when the user has < 10 evaluated ' +
      'trades.',
  })
  @ApiQuery({
    name: 'period_days',
    required: false,
    description: 'Rolling analysis window in days (default 90).',
  })
  @ApiResponse({ status: 200, description: 'The behavioral report.' })
  @ApiResponse({
    status: 204,
    description:
      '{ message: "insufficient_data", tradesRequired: 10, tradesEvaluated: N }',
  })
  async getBehavioralReport(
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('period_days') periodDays?: string,
  ) {
    const window = this.parsePeriodDays(periodDays);
    const result = await this.behavioralReports.getOrGenerate(
      req.user.id,
      window,
      req.user.language,
    );

    if (isInsufficientData(result)) {
      // Spec 11: 204 with a discriminator body. Fastify omits the body on a
      // standards-compliant 204; the client keys off the status. We still
      // return the payload so non-stripping clients and tests can read it.
      reply.status(HttpStatus.NO_CONTENT);
      return {
        message: 'insufficient_data',
        tradesRequired: result.tradesRequired,
        tradesEvaluated: result.tradesEvaluated,
      };
    }

    return result;
  }

  @Get('stats/summary')
  @ApiOperation({
    summary:
      'Aggregate evaluation stats across ALL of the user’s evaluated trades ' +
      '(avgProcessScore, goodTradeRate, luckyTradeRate, winRate, avgRMultiple).',
  })
  @ApiResponse({ status: 200, description: 'The aggregate stats summary.' })
  getStatsSummary(@Request() req: AuthenticatedRequest) {
    return this.behavioralReports.statsSummary(req.user.id);
  }

  /** Parses the period_days query (positive int) → defaults to 90. */
  private parsePeriodDays(raw?: string): number {
    if (!raw) return DEFAULT_PERIOD_DAYS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_PERIOD_DAYS;
  }
}
