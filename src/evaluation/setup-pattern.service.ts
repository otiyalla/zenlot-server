import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/prisma/client';
import { Confidence, PatternType } from './engine';
import {
  CUSTOM_PATTERN_LIBRARY_MAX,
  normalizeSetupPatternName,
} from './setup-pattern.util';

/** One entry of the trader's custom pattern library, as served to the client. */
export interface SetupPatternSuggestion {
  name: string;
  usageCount: number;
  lastUsedAt: string;
}

/** The declared pattern block of a submitted checklist. */
export interface DeclaredPattern {
  identified: boolean;
  type: PatternType;
  customName?: string;
  confidence: Confidence;
}

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * The trader's custom setup pattern library and the pattern→trade link
 * (SCRUM-59).
 *
 * Two responsibilities, deliberately kept together because they are written in
 * the same step:
 *
 *  - **Library** (`customSetupPattern`): every distinct free-text name a trader
 *    has used, de-duplicated on a case-folded key, with usage counts so the most
 *    familiar names can be offered first as autocomplete suggestions.
 *  - **Usage link** (`setupPatternUsage`): one row per checklist that declared a
 *    pattern — of ANY type, not just custom — so a pattern can later be joined
 *    to the trade it was used on.
 *
 * Nothing here is allowed to fail a checklist submission or a trade log: callers
 * invoke these methods inside try/catch, and the internals swallow races.
 */
@Injectable()
export class SetupPatternService {
  private readonly logger = new Logger(SetupPatternService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a declared pattern: upserts the library entry when the trader typed
   * a custom name, then writes the usage row that links it to this checklist.
   *
   * A checklist that declared no pattern (`identified: false`) records nothing —
   * there is no pattern to reference later.
   */
  async record(
    userId: string,
    pattern: DeclaredPattern,
    checklistId: string,
  ): Promise<void> {
    if (!pattern.identified) return;

    const { display, normalized } =
      pattern.type === 'other'
        ? normalizeSetupPatternName(pattern.customName)
        : { display: '', normalized: '' };

    const customPatternId = normalized
      ? await this.upsertLibraryEntry(userId, display, normalized)
      : null;

    await this.prisma.setupPatternUsage.create({
      data: {
        userId,
        patternType: pattern.type,
        customPatternId,
        // Snapshot the name even when the library entry was not created (cap
        // reached), so the checklist's history is never lost.
        customName: display || null,
        confidence: pattern.confidence,
        checklistId,
        tradeId: null,
      },
    });
  }

  /**
   * Back-fills the trade on the usage row once the checklist is bound to a
   * trade. Guarded on `tradeId: null` so a concurrent re-link cannot overwrite
   * the race winner, mirroring how the checklist itself is claimed.
   */
  async linkUsageToTrade(
    userId: string,
    checklistId: string,
    tradeId: string,
  ): Promise<void> {
    await this.prisma.setupPatternUsage.updateMany({
      where: { userId, checklistId, tradeId: null },
      data: { tradeId },
    });
  }

  /**
   * The trader's custom pattern library, most-used first. Returned whole: it is
   * capped per user and small, so the client filters locally as the trader types
   * rather than issuing a request per keystroke.
   */
  async list(userId: string): Promise<SetupPatternSuggestion[]> {
    const rows = await this.prisma.customSetupPattern.findMany({
      where: { userId },
      orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }],
      take: CUSTOM_PATTERN_LIBRARY_MAX,
      select: { name: true, usageCount: true, lastUsedAt: true },
    });

    return rows.map((row) => ({
      name: row.name,
      usageCount: row.usageCount,
      lastUsedAt: row.lastUsedAt.toISOString(),
    }));
  }

  /**
   * Creates or bumps the library entry for a name, returning its id — or null
   * when the user is at the library cap and this is a name they have not used
   * before. Existing names always keep counting, so the cap never freezes the
   * ordering of a library already in use.
   */
  private async upsertLibraryEntry(
    userId: string,
    display: string,
    normalized: string,
  ): Promise<string | null> {
    const existing = await this.prisma.customSetupPattern.findUnique({
      where: { userId_normalizedName: { userId, normalizedName: normalized } },
      select: { id: true },
    });

    if (existing) return this.bumpLibraryEntry(existing.id, display);

    const count = await this.prisma.customSetupPattern.count({
      where: { userId },
    });
    if (count >= CUSTOM_PATTERN_LIBRARY_MAX) {
      this.logger.warn(
        `Custom setup pattern library full for user ${userId}; not storing a new name`,
      );
      return null;
    }

    try {
      const created = await this.prisma.customSetupPattern.create({
        data: { userId, name: display, normalizedName: normalized },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      // Another device created the same name between our read and write. Take
      // theirs and count this use against it.
      const raced = await this.prisma.customSetupPattern.findUnique({
        where: {
          userId_normalizedName: { userId, normalizedName: normalized },
        },
        select: { id: true },
      });
      return raced ? this.bumpLibraryEntry(raced.id, display) : null;
    }
  }

  /** Counts one more use of an existing entry and refreshes its display casing. */
  private async bumpLibraryEntry(id: string, display: string): Promise<string> {
    await this.prisma.customSetupPattern.update({
      where: { id },
      data: {
        usageCount: { increment: 1 },
        lastUsedAt: new Date(),
        name: display,
      },
    });
    return id;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    );
  }
}
