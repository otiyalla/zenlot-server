/**
 * Language-tag resolution shared by the email templates and the push
 * notification copy, so both surfaces answer "which language is this user?"
 * identically.
 *
 * Only the BCP-47 *primary subtag* is matched, so regional variants
 * ('es-419', 'es_MX', 'fr-CA') resolve to their base language while
 * lookalike three-letter codes do not: 'est' (Estonian) and 'fry' (Frisian)
 * would both be false positives under a naive startsWith check.
 */

export type SupportedLanguage = 'en' | 'fr' | 'es';

export const resolveSupportedLanguage = (
  input: string | null | undefined,
): SupportedLanguage => {
  const primarySubtag = String(input ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_]/u)[0];

  if (primarySubtag === 'fr' || primarySubtag === 'es') {
    return primarySubtag;
  }
  return 'en';
};
