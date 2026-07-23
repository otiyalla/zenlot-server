import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { riskProfile } from '../../prisma/generated/prisma/client';
import { UpdateRiskProfileDto } from './dto/update-risk-profile.dto';
import { DrawdownService } from './drawdown.service';

const toNumber = (value: number | { toString(): string }): number =>
  typeof value === 'number' ? value : Number(value.toString());

const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Plain scalar patch shared by the upsert's `update` and `create` branches.
 * Concrete primitives (not Prisma field-update operations) so the same object
 * satisfies both input types.
 */
type RiskProfileScalarPatch = Partial<{
  maxRiskPerTradePct: number;
  maxPortfolioExposurePct: number;
  maxDailyDrawdownPct: number;
  maxWeeklyDrawdownPct: number;
  maxMonthlyDrawdownPct: number;
  maxOpenTrades: number;
  maxCorrelatedExposure: number;
  accountBalance: number;
  lastBalanceSetAt: Date;
  lastBalanceSource: string;
  overrideMode: string;
}>;

/**
 * A risk profile as returned to clients. Mirrors the stored row plus
 * `accountCurrency`, which is the single source of truth on the `user` record
 * (kept off the profile table to avoid drift — spec Phase 1 RiskProfile).
 */
export interface RiskProfileResponse extends Omit<
  riskProfile,
  'accountBalance'
> {
  accountBalance: number;
  accountCurrency: string;
}

function toRiskProfileResponse(
  profile: riskProfile,
  accountCurrency: string,
): RiskProfileResponse {
  return {
    ...profile,
    accountBalance: toNumber(profile.accountBalance),
    accountCurrency,
  };
}

@Injectable()
export class RiskProfileService {
  private readonly logger = new Logger(RiskProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly drawdownService: DrawdownService,
  ) {}

  /**
   * Returns the user's risk profile, lazily creating one with the spec's
   * conservative defaults on first access (1% / 3% / 5% / 8% / 10% / 5 / 6%).
   */
  async getProfile(
    userId: string,
    accountCurrency: string,
  ): Promise<RiskProfileResponse> {
    const profile = await this.prisma.riskProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return toRiskProfileResponse(profile, accountCurrency);
  }

  /**
   * Patches the user's risk governance rules. Setting `accountBalance` is treated
   * as an explicit manual reconciliation, so `lastBalanceSource` is stamped
   * 'manual' and `lastBalanceSetAt` is refreshed (spec Section 11.2).
   */
  async updateProfile(
    userId: string,
    dto: UpdateRiskProfileDto,
    accountCurrency: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<RiskProfileResponse> {
    const data: RiskProfileScalarPatch = {};

    if (dto.maxRiskPerTradePct !== undefined)
      data.maxRiskPerTradePct = dto.maxRiskPerTradePct;
    if (dto.maxPortfolioExposurePct !== undefined)
      data.maxPortfolioExposurePct = dto.maxPortfolioExposurePct;
    if (dto.maxDailyDrawdownPct !== undefined)
      data.maxDailyDrawdownPct = dto.maxDailyDrawdownPct;
    if (dto.maxWeeklyDrawdownPct !== undefined)
      data.maxWeeklyDrawdownPct = dto.maxWeeklyDrawdownPct;
    if (dto.maxMonthlyDrawdownPct !== undefined)
      data.maxMonthlyDrawdownPct = dto.maxMonthlyDrawdownPct;
    if (dto.maxOpenTrades !== undefined) data.maxOpenTrades = dto.maxOpenTrades;
    if (dto.maxCorrelatedExposure !== undefined)
      data.maxCorrelatedExposure = dto.maxCorrelatedExposure;
    if (dto.overrideMode !== undefined) data.overrideMode = dto.overrideMode;
    const balanceChanged = dto.accountBalance !== undefined;
    if (balanceChanged) {
      data.accountBalance = roundCurrency(dto.accountBalance as number);
      data.lastBalanceSetAt = new Date();
      data.lastBalanceSource = 'manual';
    }

    // When the balance is manually reconciled we must keep the drawdown row's
    // running balance in lock-step with the profile — otherwise the Drawdown
    // screen (which reads drawdownState, seeded once and only moved by realized
    // PnL) shows a stale value. Do both writes in one transaction so they never
    // diverge.
    const profile = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.riskProfile.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });
      if (balanceChanged) {
        await this.drawdownService.setManualBalance(
          tx,
          userId,
          data.accountBalance as number,
        );
      }
      return updated;
    });

    try {
      await this.auditService.log({
        userId,
        action: 'RISK_PROFILE_UPDATED',
        resource: 'riskProfile',
        resourceId: userId,
        changes: { updated: dto },
        ipAddress,
        userAgent,
      });
    } catch (error) {
      // Audit must never block the update.
      this.logger.error('Risk profile audit logging failed', error);
      Sentry.captureException(error, {
        extra: { userId, context: 'updateProfile' },
      });
    }

    return toRiskProfileResponse(profile, accountCurrency);
  }
}
