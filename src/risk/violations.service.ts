import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GovernanceCheck } from './engine';

/** Per-rule tally of how often a governance rule was broken. */
export interface RuleViolationStat {
  rule: string;
  /** Human-readable message for the rule (latest seen). */
  message: string;
  /** Times the rule fired as a hard (blocking) violation. */
  blocked: number;
  /** Times the rule fired as a soft (warning) violation. */
  warning: number;
  /** Times the user knowingly overrode this rule. */
  overridden: number;
}

/** A single trade the user logged despite a blocking rule. */
export interface OverrideRecord {
  tradeId: string | null;
  blockedReason: string | null;
  rules: string[];
  /** The user's free-text justification for the override, if they gave one. */
  reason: string | null;
  createdAt: Date;
}

export interface ViolationsSummary {
  /** Trades logged through the risk engine (governance evaluated). */
  totalLogged: number;
  /** Trades the user logged despite a blocking rule. */
  totalOverrides: number;
  /** overrides / totalLogged, 0..1 (0 when nothing logged). */
  overrideRate: number;
  /** Per-rule breakdown, most-broken first. */
  byRule: RuleViolationStat[];
  /** Most recent overrides (newest first), capped. */
  recentOverrides: OverrideRecord[];
}

const RECENT_OVERRIDE_LIMIT = 10;

@Injectable()
export class ViolationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregates the user's governance logs into a rule-violation summary for the
   * dashboard. Computed in-app from `checksJson` (journal-scale volumes); if this
   * ever needs to scale, the violations can be normalised into their own table.
   */
  async getViolations(userId: string): Promise<ViolationsSummary> {
    const logs = await this.prisma.governanceLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        tradeId: true,
        overallStatus: true,
        checksJson: true,
        blockedReason: true,
        acknowledged: true,
        acknowledgedRules: true,
        overrideReason: true,
        createdAt: true,
      },
    });

    const byRule = new Map<string, RuleViolationStat>();
    const recentOverrides: OverrideRecord[] = [];
    let totalOverrides = 0;

    for (const log of logs) {
      if (log.acknowledged) {
        totalOverrides++;
        if (recentOverrides.length < RECENT_OVERRIDE_LIMIT) {
          recentOverrides.push({
            tradeId: log.tradeId,
            blockedReason: log.blockedReason,
            rules: log.acknowledgedRules,
            reason: log.overrideReason,
            createdAt: log.createdAt,
          });
        }
      }

      const checks = (log.checksJson as unknown as GovernanceCheck[]) ?? [];
      for (const check of checks) {
        if (check.informational || check.status === 'approved') continue;

        const stat = byRule.get(check.rule) ?? {
          rule: check.rule,
          message: check.message,
          blocked: 0,
          warning: 0,
          overridden: 0,
        };
        if (check.status === 'blocked') stat.blocked++;
        else if (check.status === 'warning') stat.warning++;
        if (log.acknowledged && log.acknowledgedRules.includes(check.rule)) {
          stat.overridden++;
        }
        byRule.set(check.rule, stat);
      }
    }

    const sorted = [...byRule.values()].sort(
      (a, b) => b.blocked + b.warning - (a.blocked + a.warning),
    );

    return {
      totalLogged: logs.length,
      totalOverrides,
      overrideRate: logs.length ? totalOverrides / logs.length : 0,
      byRule: sorted,
      recentOverrides,
    };
  }
}
