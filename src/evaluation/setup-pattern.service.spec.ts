import { SetupPatternService, DeclaredPattern } from './setup-pattern.service';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../prisma/generated/prisma/client';
import {
  CUSTOM_PATTERN_LIBRARY_MAX,
  normalizeSetupPatternName,
} from './setup-pattern.util';

const USER_ID = 'u1';
const CHECKLIST_ID = 'chk-1';

const declared = (
  overrides: Partial<DeclaredPattern> = {},
): DeclaredPattern => ({
  identified: true,
  type: 'other',
  customName: 'Head and Shoulders',
  confidence: 'high',
  ...overrides,
});

function makeService(
  opts: {
    findUnique?: jest.Mock;
    create?: jest.Mock;
    update?: jest.Mock;
    count?: jest.Mock;
    findMany?: jest.Mock;
    usageCreate?: jest.Mock;
    usageUpdateMany?: jest.Mock;
  } = {},
) {
  const findUnique = opts.findUnique ?? jest.fn().mockResolvedValue(null);
  const create =
    opts.create ?? jest.fn().mockResolvedValue({ id: 'pattern-1' });
  const update = opts.update ?? jest.fn().mockResolvedValue({});
  const count = opts.count ?? jest.fn().mockResolvedValue(0);
  const findMany = opts.findMany ?? jest.fn().mockResolvedValue([]);
  const usageCreate = opts.usageCreate ?? jest.fn().mockResolvedValue({});
  const usageUpdateMany =
    opts.usageUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    customSetupPattern: { findUnique, create, update, count, findMany },
    setupPatternUsage: { create: usageCreate, updateMany: usageUpdateMany },
  } as unknown as PrismaService;

  return {
    service: new SetupPatternService(prisma),
    findUnique,
    create,
    update,
    count,
    findMany,
    usageCreate,
    usageUpdateMany,
  };
}

/** The unique-constraint error Prisma raises when two devices race. */
const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('normalizeSetupPatternName', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSetupPatternName('  Head   and\tShoulders  ').display).toBe(
      'Head and Shoulders',
    );
  });

  it('keeps the typed casing for display but case-folds the uniqueness key', () => {
    const { display, normalized } = normalizeSetupPatternName('Bull FLAG');
    expect(display).toBe('Bull FLAG');
    expect(normalized).toBe('bull flag');
  });

  it('treats case and spacing variants as the same key', () => {
    expect(normalizeSetupPatternName('Head and Shoulders').normalized).toBe(
      normalizeSetupPatternName('head  AND shoulders').normalized,
    );
  });

  it('strips zero-width and control characters', () => {
    // A zero-width space inside a word is removed, not turned into a space.
    expect(normalizeSetupPatternName('Bull\u200BFlag').display).toBe(
      'BullFlag',
    );
    expect(normalizeSetupPatternName('Bull\u0000Flag').display).toBe(
      'BullFlag',
    );
  });

  it('treats tabs and newlines as separators, not characters to delete', () => {
    expect(normalizeSetupPatternName('Head\tand\nShoulders').display).toBe(
      'Head and Shoulders',
    );
  });

  it('does not leave a double space where a zero-width character was removed', () => {
    expect(normalizeSetupPatternName('Bull \u200B Flag').display).toBe(
      'Bull Flag',
    );
  });

  it('normalises unicode so composed and decomposed forms match', () => {
    // 'Cafe' + combining acute (U+0301) vs. the precomposed U+00E9.
    expect(normalizeSetupPatternName('Cafe\u0301 Setup').normalized).toBe(
      normalizeSetupPatternName('Caf\u00E9 Setup').normalized,
    );
  });

  it('clamps to the stored maximum without leaving a trailing space', () => {
    const { display } = normalizeSetupPatternName(`${'a'.repeat(63)}  bbbb`);
    expect(display.length).toBeLessThanOrEqual(64);
    expect(display).toBe(display.trim());
  });

  it('returns empty strings for absent or whitespace-only input', () => {
    expect(normalizeSetupPatternName(undefined).display).toBe('');
    expect(normalizeSetupPatternName(null).normalized).toBe('');
    expect(normalizeSetupPatternName('   ').display).toBe('');
  });
});

describe('SetupPatternService.record', () => {
  it('creates a library entry and a usage row for a new custom name', async () => {
    const { service, create, usageCreate } = makeService();

    await service.record(USER_ID, declared(), CHECKLIST_ID);

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        name: 'Head and Shoulders',
        normalizedName: 'head and shoulders',
      },
      select: { id: true },
    });
    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        patternType: 'other',
        customPatternId: 'pattern-1',
        customName: 'Head and Shoulders',
        confidence: 'high',
        checklistId: CHECKLIST_ID,
        tradeId: null,
      }),
    });
  });

  it('counts a repeat use against the existing entry instead of inserting', async () => {
    const { service, create, update } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'pattern-9' }),
    });

    await service.record(
      USER_ID,
      declared({ customName: 'head AND shoulders' }),
      CHECKLIST_ID,
    );

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pattern-9' },
      data: expect.objectContaining({
        usageCount: { increment: 1 },
        // Display casing follows the most recent use.
        name: 'head AND shoulders',
      }),
    });
  });

  it('records a usage row for a known (non-custom) pattern type', async () => {
    const { service, create, usageCreate } = makeService();

    await service.record(
      USER_ID,
      declared({ type: 'head_and_shoulders', customName: undefined }),
      CHECKLIST_ID,
    );

    // Known types never touch the custom library…
    expect(create).not.toHaveBeenCalled();
    // …but are still linked, so pattern performance is queryable.
    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patternType: 'head_and_shoulders',
        customPatternId: null,
        customName: null,
      }),
    });
  });

  it('records nothing when no pattern was declared', async () => {
    const { service, create, usageCreate } = makeService();

    await service.record(
      USER_ID,
      declared({ identified: false }),
      CHECKLIST_ID,
    );

    expect(create).not.toHaveBeenCalled();
    expect(usageCreate).not.toHaveBeenCalled();
  });

  it('skips the library for an empty custom name but still records the usage', async () => {
    const { service, create, usageCreate } = makeService();

    await service.record(
      USER_ID,
      declared({ customName: '   ' }),
      CHECKLIST_ID,
    );

    expect(create).not.toHaveBeenCalled();
    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patternType: 'other',
        customPatternId: null,
        customName: null,
      }),
    });
  });

  it('stops adding new names once the library is full, keeping the snapshot', async () => {
    const { service, create, usageCreate } = makeService({
      count: jest.fn().mockResolvedValue(CUSTOM_PATTERN_LIBRARY_MAX),
    });

    await service.record(
      USER_ID,
      declared({ customName: 'Brand New' }),
      CHECKLIST_ID,
    );

    expect(create).not.toHaveBeenCalled();
    // Nothing the trader typed is lost — it still rides on the usage row.
    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customPatternId: null,
        customName: 'Brand New',
      }),
    });
  });

  it('still counts an existing name when the library is full', async () => {
    const { service, update } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'pattern-9' }),
      count: jest.fn().mockResolvedValue(CUSTOM_PATTERN_LIBRARY_MAX),
    });

    await service.record(USER_ID, declared(), CHECKLIST_ID);

    expect(update).toHaveBeenCalled();
  });

  it('adopts the winner when two devices create the same name at once', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null) // our read: not there yet
      .mockResolvedValueOnce({ id: 'pattern-race' }); // after the race is lost
    const { service, update, usageCreate } = makeService({
      findUnique,
      create: jest.fn().mockRejectedValue(uniqueViolation()),
    });

    await service.record(USER_ID, declared(), CHECKLIST_ID);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'pattern-race' },
      data: expect.objectContaining({ usageCount: { increment: 1 } }),
    });
    expect(usageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ customPatternId: 'pattern-race' }),
    });
  });

  it('propagates a non-unique-constraint failure', async () => {
    const { service } = makeService({
      create: jest.fn().mockRejectedValue(new Error('connection lost')),
    });

    await expect(
      service.record(USER_ID, declared(), CHECKLIST_ID),
    ).rejects.toThrow('connection lost');
  });
});

describe('SetupPatternService.linkUsageToTrade', () => {
  it('back-fills the trade only while the usage row is still unlinked', async () => {
    const { service, usageUpdateMany } = makeService();

    await service.linkUsageToTrade(USER_ID, CHECKLIST_ID, 't1');

    expect(usageUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, checklistId: CHECKLIST_ID, tradeId: null },
      data: { tradeId: 't1' },
    });
  });
});

describe('SetupPatternService.list', () => {
  it('returns the library most-used first, scoped to the user', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        name: 'Head and Shoulders',
        usageCount: 7,
        lastUsedAt: new Date('2026-09-01T10:00:00Z'),
      },
      {
        name: 'Bat Harmonic',
        usageCount: 2,
        lastUsedAt: new Date('2026-09-02T10:00:00Z'),
      },
    ]);
    const { service } = makeService({ findMany });

    const result = await service.list(USER_ID);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }],
        take: CUSTOM_PATTERN_LIBRARY_MAX,
      }),
    );
    expect(result).toEqual([
      {
        name: 'Head and Shoulders',
        usageCount: 7,
        lastUsedAt: '2026-09-01T10:00:00.000Z',
      },
      {
        name: 'Bat Harmonic',
        usageCount: 2,
        lastUsedAt: '2026-09-02T10:00:00.000Z',
      },
    ]);
  });

  it('returns an empty list for a trader with no custom patterns', async () => {
    const { service } = makeService();
    await expect(service.list(USER_ID)).resolves.toEqual([]);
  });
});
