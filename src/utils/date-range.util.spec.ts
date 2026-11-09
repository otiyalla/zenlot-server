import { parseInclusiveDateRangeEnd } from './date-range.util';

describe('parseInclusiveDateRangeEnd', () => {
  it.each([
    ['2026-07-27', '2026-07-27T23:59:59.999Z'],
    ['2026-02-28', '2026-02-28T23:59:59.999Z'],
  ])(
    'expands date-only input %s to the end of its UTC day',
    (value, expected) => {
      expect(parseInclusiveDateRangeEnd(value).toISOString()).toBe(expected);
    },
  );

  it('preserves an explicit date-time instant', () => {
    const value = '2026-07-27T14:30:00.000Z';
    expect(parseInclusiveDateRangeEnd(value).toISOString()).toBe(value);
  });
});
