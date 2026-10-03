/**
 * Normalisation for custom setup pattern names (SCRUM-59).
 *
 * Lives in its own module because both the validation layer
 * (`dto/submit-checklist.dto.ts`) and the persistence layer
 * (`setup-pattern.service.ts`) need the same rules, and the client applies an
 * identical rule locally when filtering autocomplete suggestions
 * (`Zenlot/constants/setupPatterns.ts`). Keep the two in step.
 */

/** Max stored length of a custom pattern name; matches VarChar(64) in the schema. */
export const CUSTOM_PATTERN_NAME_MAX = 64;

/**
 * Most custom names a single user may accumulate. Beyond this, existing names
 * still record usage but genuinely new ones are not added to the library — the
 * typed name is still kept on the checklist itself, so nothing the trader
 * entered is lost.
 */
export const CUSTOM_PATTERN_LIBRARY_MAX = 200;

export interface NormalizedPatternName {
  /** The name as it should be displayed — the trader's own casing, tidied up. */
  display: string;
  /** Case-folded form (see `foldSetupPatternName`), the per-user uniqueness key. */
  normalized: string;
}

/**
 * Locale-independent Unicode case folding for the uniqueness key.
 *
 * Plain `toLowerCase()` is not a fold: it is context-sensitive, so "ΟΣ" becomes
 * "ος" (final sigma) while the casing-equivalent "οσ" stays "οσ", and "ẞ" / "SS"
 * never meet "ß". Round-tripping through upper case collapses every casing
 * variant onto one form first, so the final lowercase pass depends only on the
 * letters and their position: σ/ς/Σ collapse together, ß/ẞ/SS → "ss", and
 * titlecase "ǅ" → "ǆ".
 *
 * Deliberately NOT `toLocaleLowerCase()`, which varies with the server's locale
 * (Turkish maps "I" to "ı"). One deviation from strict CaseFolding.txt: dotless
 * "ı" folds with "i". The client mirrors this exactly.
 */
export function foldSetupPatternName(value: string): string {
  return value.toLowerCase().toUpperCase().toLowerCase();
}

/**
 * Tidies a raw typed name into its display and uniqueness forms:
 * NFKC normalise → collapse whitespace runs to a single space → strip the
 * remaining Unicode control/format characters → trim → clamp to
 * CUSTOM_PATTERN_NAME_MAX.
 *
 * Order matters. Tabs and newlines are themselves control characters, so
 * whitespace must be collapsed BEFORE stripping — otherwise "Head\tShoulders"
 * loses the separator and becomes "HeadShoulders". Stripping can in turn leave
 * a double space (e.g. around a zero-width character), so whitespace is
 * collapsed once more afterwards.
 *
 * Length is measured in Unicode code points, not UTF-16 units: Postgres
 * VarChar(n) counts characters, and cutting a surrogate pair in half would leave
 * an unpaired surrogate that JSONB rejects. Case folding can lengthen a string
 * ("İ" folds to two code points, "ß" to "ss"), so the display name is shortened
 * further, if need be, until its folded key also fits — both columns are
 * VarChar(64).
 *
 * Returns empty strings for input that is absent or only whitespace, which
 * callers treat as "no custom name given".
 */
export function normalizeSetupPatternName(
  raw: string | null | undefined,
): NormalizedPatternName {
  const tidy = String(raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    // Zero-width and control characters would corrupt display and comparison
    // alike; real whitespace has already become plain spaces above. `\p{C}`
    // also matches any unpaired surrogate in the input.
    .replace(/\p{C}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  // Spreading iterates by code point, so a surrogate pair is never split.
  const points = [...tidy].slice(0, CUSTOM_PATTERN_NAME_MAX);

  for (;;) {
    // Cutting can leave a trailing space; tidy it again.
    const display = points.join('').trim();
    const normalized = foldSetupPatternName(display);
    if ([...normalized].length <= CUSTOM_PATTERN_NAME_MAX) {
      return { display, normalized };
    }
    points.pop();
  }
}
