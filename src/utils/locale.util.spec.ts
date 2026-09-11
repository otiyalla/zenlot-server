import { resolveSupportedLanguage } from './locale.util';

describe('resolveSupportedLanguage', () => {
  it.each([
    ['en', 'en'],
    ['fr', 'fr'],
    ['es', 'es'],
  ])('resolves the bare tag %s', (input, expected) => {
    expect(resolveSupportedLanguage(input)).toBe(expected);
  });

  it.each([
    ['es-419', 'es'],
    ['es_MX', 'es'],
    ['es-ES', 'es'],
    ['fr-CA', 'fr'],
    ['fr_FR', 'fr'],
    ['EN-GB', 'en'],
  ])(
    'resolves the regional tag %s to its primary subtag',
    (input, expected) => {
      expect(resolveSupportedLanguage(input)).toBe(expected);
    },
  );

  it.each([
    // Estonian and Frisian share a two-letter prefix with es/fr; a naive
    // startsWith check would mis-route both.
    ['est', 'en'],
    ['fry', 'en'],
    ['esperanto', 'en'],
  ])('does not match %s on a shared prefix', (input, expected) => {
    expect(resolveSupportedLanguage(input)).toBe(expected);
  });

  it.each([
    ['  ES  ', 'es'],
    ['Fr-CA', 'fr'],
  ])('ignores surrounding whitespace and casing in %s', (input, expected) => {
    expect(resolveSupportedLanguage(input)).toBe(expected);
  });

  it.each([[null], [undefined], [''], ['   '], ['de'], ['zh-Hant-TW']])(
    'falls back to English for %s',
    (input) => {
      expect(resolveSupportedLanguage(input)).toBe('en');
    },
  );
});
