import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitChecklistDto } from './submit-checklist.dto';
import { PatternType } from '../engine';
import { CUSTOM_PATTERN_NAME_MAX } from '../setup-pattern.util';

// Mirror the global ValidationPipe's implicit conversion so the test exercises
// the DTO the way the controller receives it.
const validateDto = (payload: Record<string, unknown>) =>
  validate(
    plainToInstance(SubmitChecklistDto, payload, {
      enableImplicitConversion: true,
    }),
  );

const basePayload = (pattern: Record<string, unknown>) => ({
  momentum: { higherTfDirection: 'bullish', lowerTfReversal: true, note: '' },
  pattern,
  priceZone: {
    atSignificantLevel: true,
    levelType: 'fibonacci_retracement',
    confluence: true,
    note: '',
  },
  timeConfluence: { inTimeZone: true, note: '' },
  entryTrigger: { type: 'trailing_1BH', note: '' },
  stopPlacement: { logic: 'swing_extreme', note: '' },
  overallConfidence: 'high',
  traderNotes: '',
});

/** Validation errors for the nested `pattern` object, flattened to constraints. */
const patternConstraints = async (pattern: Record<string, unknown>) => {
  const errors = await validateDto(basePayload(pattern));
  const patternError = errors.find((error) => error.property === 'pattern');
  return (patternError?.children ?? []).reduce<Record<string, unknown>>(
    (acc, child) => ({ ...acc, [child.property]: child.constraints }),
    {},
  );
};

const validPattern = {
  identified: true,
  type: 'head_and_shoulders',
  confidence: 'high',
  note: '',
};

// Every value the picker can submit, plus the legacy ones older builds send.
const ACCEPTED_TYPES: PatternType[] = [
  'abc_correction',
  'five_wave_trend',
  'head_and_shoulders',
  'inverse_head_and_shoulders',
  'double_top',
  'double_bottom',
  'triple_top',
  'triple_bottom',
  'ascending_triangle',
  'descending_triangle',
  'symmetrical_triangle',
  'bull_flag',
  'bear_flag',
  'rising_wedge',
  'falling_wedge',
  'cup_and_handle',
  'other',
  'none',
];

describe('SubmitChecklistDto — pattern type (SCRUM-59)', () => {
  it.each(ACCEPTED_TYPES)('accepts the %s pattern type', async (type) => {
    expect(
      await validateDto(basePayload({ ...validPattern, type })),
    ).toHaveLength(0);
  });

  it('still accepts "none", which older app builds send as the default', async () => {
    expect(
      await validateDto(basePayload({ ...validPattern, type: 'none' })),
    ).toHaveLength(0);
  });

  it('rejects a pattern type outside the known set', async () => {
    expect(
      await patternConstraints({ ...validPattern, type: 'moon_pattern' }),
    ).toHaveProperty('type');
  });
});

describe('SubmitChecklistDto — pattern customName (SCRUM-59)', () => {
  it('accepts a checklist with no custom name at all', async () => {
    expect(await validateDto(basePayload(validPattern))).toHaveLength(0);
  });

  it('accepts a custom name alongside the "other" type', async () => {
    expect(
      await validateDto(
        basePayload({
          ...validPattern,
          type: 'other',
          customName: 'Bat Harmonic',
        }),
      ),
    ).toHaveLength(0);
  });

  it('accepts a name exactly at the maximum length', async () => {
    expect(
      await validateDto(
        basePayload({
          ...validPattern,
          type: 'other',
          customName: 'a'.repeat(CUSTOM_PATTERN_NAME_MAX),
        }),
      ),
    ).toHaveLength(0);
  });

  it('rejects a name one character over the maximum', async () => {
    expect(
      await patternConstraints({
        ...validPattern,
        type: 'other',
        customName: 'a'.repeat(CUSTOM_PATTERN_NAME_MAX + 1),
      }),
    ).toHaveProperty('customName');
  });

  // The global pipe runs with enableImplicitConversion, so a stray non-string
  // is coerced rather than rejected. Harmless for a free-text name — and the
  // service normalises it before anything is stored — but worth pinning down so
  // the coercion is a documented decision rather than a surprise.
  it('coerces a non-string custom name instead of rejecting it', async () => {
    const dto = plainToInstance(
      SubmitChecklistDto,
      basePayload({ ...validPattern, type: 'other', customName: 42 }),
      { enableImplicitConversion: true },
    );

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.pattern.customName).toBe('42');
  });
});
