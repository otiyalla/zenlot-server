import { scoreSetupQuality, scoreToGrade } from './setup-quality';
import { makeChecklist } from './test-fixtures';

describe('scoreSetupQuality', () => {
  it('awards a perfect 100 / grade A when every factor is full', () => {
    const result = scoreSetupQuality(makeChecklist());
    expect(result.total).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.highProbability).toBe(true);
    expect(result.breakdown).toEqual([
      { factor: 'momentum', points: 30, max: 30 },
      { factor: 'pattern', points: 25, max: 25 },
      { factor: 'priceZone', points: 25, max: 25 },
      { factor: 'timeConfluence', points: 10, max: 10 },
      { factor: 'entryTrigger', points: 10, max: 10 },
    ]);
  });

  describe('momentum (30 pts): full / partial / zero', () => {
    it('full 30 when HTF clear and lower TF reversal confirmed', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          momentum: { higherTfDirection: 'bullish', lowerTfReversal: true },
        }),
      );
      expect(r.breakdown[0]).toEqual({
        factor: 'momentum',
        points: 30,
        max: 30,
      });
    });
    it('partial 15 when HTF clear but reversal not confirmed', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          momentum: { higherTfDirection: 'bearish', lowerTfReversal: false },
        }),
      );
      expect(r.breakdown[0].points).toBe(15);
    });
    it('zero when HTF direction unclear (even if reversal true)', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          momentum: { higherTfDirection: 'unclear', lowerTfReversal: true },
        }),
      );
      expect(r.breakdown[0].points).toBe(0);
    });
  });

  describe('pattern (25 pts): high / medium / low / none', () => {
    it.each([
      ['high', 25],
      ['medium', 15],
      ['low', 8],
    ] as const)('identified with %s confidence → %i', (confidence, pts) => {
      const r = scoreSetupQuality(
        makeChecklist({ pattern: { identified: true, confidence } }),
      );
      expect(r.breakdown[1].points).toBe(pts);
    });
    it('zero when no pattern identified', () => {
      const r = scoreSetupQuality(
        makeChecklist({ pattern: { identified: false, confidence: 'high' } }),
      );
      expect(r.breakdown[1].points).toBe(0);
    });

    // SCRUM-59 added 14 chart patterns and a free-text `customName`. Scoring
    // reads only `identified` + `confidence`, and it must stay that way: if a
    // pattern type ever started moving the score, every historical evaluation
    // would silently mean something different. This pins that down.
    it.each([
      'abc_correction',
      'five_wave_trend',
      'head_and_shoulders',
      'cup_and_handle',
      'other',
      'none',
    ] as const)(
      'scores identically regardless of pattern type (%s)',
      (type) => {
        const r = scoreSetupQuality(
          makeChecklist({
            pattern: { identified: true, type, confidence: 'high' },
          }),
        );
        expect(r.breakdown[1]).toEqual({
          factor: 'pattern',
          points: 25,
          max: 25,
        });
        expect(r.total).toBe(100);
      },
    );

    it('scores identically whether or not a custom name is present', () => {
      const withName = scoreSetupQuality(
        makeChecklist({
          pattern: {
            identified: true,
            type: 'other',
            customName: 'Bat Harmonic',
            confidence: 'medium',
          },
        }),
      );
      const withoutName = scoreSetupQuality(
        makeChecklist({
          pattern: { identified: true, type: 'other', confidence: 'medium' },
        }),
      );
      expect(withName.total).toBe(withoutName.total);
      expect(withName.breakdown).toEqual(withoutName.breakdown);
    });
  });

  describe('priceZone (25 pts): confluence / at-level / none', () => {
    it('full 25 at level with confluence', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          priceZone: { atSignificantLevel: true, confluence: true },
        }),
      );
      expect(r.breakdown[2].points).toBe(25);
    });
    it('partial 15 at level without confluence', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          priceZone: { atSignificantLevel: true, confluence: false },
        }),
      );
      expect(r.breakdown[2].points).toBe(15);
    });
    it('zero when not at a significant level', () => {
      const r = scoreSetupQuality(
        makeChecklist({
          priceZone: { atSignificantLevel: false, confluence: true },
        }),
      );
      expect(r.breakdown[2].points).toBe(0);
    });
  });

  describe('timeConfluence (10 pts soft)', () => {
    it('10 in time zone, 0 otherwise', () => {
      expect(
        scoreSetupQuality(
          makeChecklist({ timeConfluence: { inTimeZone: true } }),
        ).breakdown[3].points,
      ).toBe(10);
      expect(
        scoreSetupQuality(
          makeChecklist({ timeConfluence: { inTimeZone: false } }),
        ).breakdown[3].points,
      ).toBe(0);
    });
  });

  describe('entryTrigger (10 pts)', () => {
    it.each([
      ['trailing_1BH', 10],
      ['trailing_1BL', 10],
      ['swing_entry', 6],
      ['limit', 4],
      ['market', 0],
      ['other', 0],
    ] as const)('%s → %i', (type, pts) => {
      const r = scoreSetupQuality(makeChecklist({ entryTrigger: { type } }));
      expect(r.breakdown[4].points).toBe(pts);
    });
  });

  it('highProbability flips at the 70 boundary', () => {
    // Build exactly 70: momentum 30 + pattern 25 + time 10 + trigger 0 + zone 0 = 65 → tweak.
    // momentum 30 + pattern 25 + zone 15 (at-level, no confluence) = 70.
    const at70 = scoreSetupQuality(
      makeChecklist({
        priceZone: { atSignificantLevel: true, confluence: false },
        timeConfluence: { inTimeZone: false },
        entryTrigger: { type: 'market' },
      }),
    );
    expect(at70.total).toBe(70);
    expect(at70.highProbability).toBe(true);

    const at69 = scoreSetupQuality(
      makeChecklist({
        momentum: { higherTfDirection: 'bullish', lowerTfReversal: true },
        pattern: { identified: true, confidence: 'medium' }, // 15
        priceZone: { atSignificantLevel: true, confluence: true }, // 25
        timeConfluence: { inTimeZone: false }, // 0
        entryTrigger: { type: 'other' }, // 0
      }),
    );
    expect(at69.total).toBe(70); // 30+15+25 = 70
    // construct a sub-70 case explicitly:
    const at54 = scoreSetupQuality(
      makeChecklist({
        momentum: { higherTfDirection: 'unclear', lowerTfReversal: false }, // 0
        pattern: { identified: true, confidence: 'high' }, // 25
        priceZone: { atSignificantLevel: true, confluence: false }, // 15
        timeConfluence: { inTimeZone: false }, // 0
        entryTrigger: { type: 'trailing_1BH' }, // 10
      }),
    );
    expect(at54.total).toBe(50);
    expect(at54.highProbability).toBe(false);
  });
});

describe('scoreToGrade — exact cutoffs', () => {
  it.each([
    [100, 'A'],
    [85, 'A'],
    [84, 'B'],
    [70, 'B'],
    [69, 'C'],
    [55, 'C'],
    [54, 'D'],
    [40, 'D'],
    [39, 'F'],
    [0, 'F'],
  ] as const)('%i → %s', (score, grade) => {
    expect(scoreToGrade(score)).toBe(grade);
  });
});
