import { ViolationsService } from './violations.service';
import { PrismaService } from '../prisma/prisma.service';

function makeService(logs: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(logs);
  const prisma = {
    governanceLog: { findMany },
  } as unknown as PrismaService;
  return { service: new ViolationsService(prisma), findMany };
}

const log = (over: Partial<Record<string, unknown>> = {}) => ({
  tradeId: 't1',
  overallStatus: 'warning',
  blockedReason: null,
  acknowledged: false,
  acknowledgedRules: [],
  overrideReason: null,
  createdAt: new Date('2026-06-19T00:00:00Z'),
  checksJson: [],
  ...over,
});

const check = (rule: string, status: string) => ({
  rule,
  status,
  actual: 1,
  limit: 1,
  message: `${rule} message`,
});

describe('ViolationsService.getViolations', () => {
  it('returns an empty summary when nothing has been logged', async () => {
    const { service } = makeService([]);
    const result = await service.getViolations('u1');
    expect(result).toEqual({
      totalLogged: 0,
      totalOverrides: 0,
      overrideRate: 0,
      byRule: [],
      recentOverrides: [],
    });
  });

  it('tallies blocked/warning/overridden counts per rule', async () => {
    const { service } = makeService([
      log({
        overallStatus: 'blocked',
        acknowledged: true,
        acknowledgedRules: ['maxPortfolioExposure'],
        overrideReason: 'News play, taking the risk',
        blockedReason: 'exposure too high',
        checksJson: [
          check('maxPortfolioExposure', 'blocked'),
          check('minRewardToRisk', 'warning'),
          check('maxOpenTrades', 'approved'),
        ],
      }),
      log({
        checksJson: [check('minRewardToRisk', 'warning')],
      }),
    ]);

    const result = await service.getViolations('u1');

    expect(result.totalLogged).toBe(2);
    expect(result.totalOverrides).toBe(1);
    expect(result.overrideRate).toBe(0.5);

    const exposure = result.byRule.find(
      (r) => r.rule === 'maxPortfolioExposure',
    );
    expect(exposure).toMatchObject({ blocked: 1, warning: 0, overridden: 1 });

    const rr = result.byRule.find((r) => r.rule === 'minRewardToRisk');
    expect(rr).toMatchObject({ blocked: 0, warning: 2, overridden: 0 });

    // 'approved' checks are never counted as violations.
    expect(
      result.byRule.find((r) => r.rule === 'maxOpenTrades'),
    ).toBeUndefined();

    expect(result.recentOverrides).toHaveLength(1);
    expect(result.recentOverrides[0]).toMatchObject({
      tradeId: 't1',
      rules: ['maxPortfolioExposure'],
      blockedReason: 'exposure too high',
      reason: 'News play, taking the risk',
    });
  });

  it('ignores informational checks', async () => {
    const { service } = makeService([
      log({
        checksJson: [
          { ...check('maxRiskPerTrade', 'blocked'), informational: true },
        ],
      }),
    ]);
    const result = await service.getViolations('u1');
    expect(result.byRule).toEqual([]);
  });
});
