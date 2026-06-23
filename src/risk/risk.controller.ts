import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { RiskProfileService } from './risk-profile.service';
import { RiskCalculationService } from './risk-calculation.service';
import { PortfolioService } from './portfolio.service';
import { DrawdownService } from './drawdown.service';
import { TradeLogService } from './trade-log.service';
import { ViolationsService } from './violations.service';
import { UpdateRiskProfileDto } from './dto/update-risk-profile.dto';
import { CalculateRiskDto } from './dto/calculate-risk.dto';
import { LogTradeDto } from './dto/log-trade.dto';
import { CloseTradeDto } from './dto/close-trade.dto';
import { AuthenticatedRequest } from '../user/interfaces/authenticated-request.interface';

@ApiTags('Risk')
@ApiSecurity('access-token')
@Controller('risk')
export class RiskController {
  constructor(
    private readonly riskProfileService: RiskProfileService,
    private readonly riskCalculationService: RiskCalculationService,
    private readonly portfolioService: PortfolioService,
    private readonly drawdownService: DrawdownService,
    private readonly tradeLogService: TradeLogService,
    private readonly violationsService: ViolationsService,
  ) {}

  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Size a prospective trade and run the governance check',
  })
  @ApiResponse({
    status: 200,
    description:
      'Calculation and governance result. AI coaching is null on this response.',
  })
  calculate(
    @Body() dto: CalculateRiskDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.riskCalculationService.calculate(
      req.user.id,
      req.user.accountCurrency,
      dto,
      req.user.language,
    );
  }

  @Get('profile')
  @ApiOperation({ summary: "Get the authenticated user's risk profile" })
  @ApiResponse({
    status: 200,
    description: 'Risk profile fetched successfully.',
  })
  getProfile(@Request() req: AuthenticatedRequest) {
    return this.riskProfileService.getProfile(
      req.user.id,
      req.user.accountCurrency,
    );
  }

  @Put('profile')
  @ApiOperation({ summary: "Update the authenticated user's risk profile" })
  @ApiResponse({
    status: 200,
    description: 'Risk profile updated successfully.',
  })
  updateProfile(
    @Body() dto: UpdateRiskProfileDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.riskProfileService.updateProfile(
      req.user.id,
      dto,
      req.user.accountCurrency,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('portfolio')
  @ApiOperation({ summary: 'Get the open-trade portfolio exposure snapshot' })
  @ApiResponse({ status: 200, description: 'Portfolio snapshot fetched.' })
  getPortfolio(@Request() req: AuthenticatedRequest) {
    return this.portfolioService.getSnapshot(req.user.id);
  }

  @Get('drawdown')
  @ApiOperation({ summary: 'Get the current drawdown / circuit-breaker state' })
  @ApiResponse({ status: 200, description: 'Drawdown state fetched.' })
  getDrawdown(@Request() req: AuthenticatedRequest) {
    return this.drawdownService.getState(req.user.id);
  }

  @Get('violations')
  @ApiOperation({
    summary: 'Rule-violation summary (how often / which rules are broken)',
  })
  @ApiResponse({ status: 200, description: 'Violations summary.' })
  getViolations(@Request() req: AuthenticatedRequest) {
    return this.violationsService.getViolations(req.user.id);
  }

  @Post('trades')
  @ApiOperation({
    summary:
      'Log a trade as open. A trade that breaks a rule returns 422 with the ' +
      'broken rules until the user acknowledges and re-submits the override.',
  })
  @ApiResponse({ status: 201, description: 'Trade logged.' })
  @ApiResponse({
    status: 422,
    description: 'Trade breaks a rule; acknowledgement required to override.',
  })
  logTrade(@Body() dto: LogTradeDto, @Request() req: AuthenticatedRequest) {
    return this.tradeLogService.logTrade(
      req.user.id,
      req.user.accountCurrency,
      dto,
      req.user.language,
    );
  }

  @Patch('trades/:id/close')
  @ApiOperation({
    summary: 'Close a trade; computes PnL, R-multiple, updates balance',
  })
  @ApiParam({ name: 'id', required: true, description: 'Trade id' })
  @ApiResponse({ status: 200, description: 'Trade closed.' })
  closeTrade(
    @Param('id') id: string,
    @Body() dto: CloseTradeDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.tradeLogService.closeTrade(req.user.id, id, dto.exitPrice);
  }
}
