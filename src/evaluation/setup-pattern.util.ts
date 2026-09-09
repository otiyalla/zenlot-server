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
  /** Case-folded form used only as the per-user uniqueness key. */
  normalized: string;
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
 * Returns empty strings for input that is absent or only whitespace, which
 * callers treat as "no custom name given".
 */
export function normalizeSetupPatternName(
  raw: string | null | undefined,
): NormalizedPatternName {
  const display = String(raw ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    // Zero-width and control characters would corrupt display and comparison
    // alike; real whitespace has already become plain spaces above.
    .replace(/\p{C}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, CUSTOM_PATTERN_NAME_MAX)
    // Slicing can strip back to a trailing space; tidy it again.
    .trim();

  return { display, normalized: display.toLocaleLowerCase() };
}
