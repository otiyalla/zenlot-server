/**
 * Parses an inclusive date-range end. Date-only inputs represent the whole
 * UTC calendar day; date-times retain their explicitly supplied instant.
 */
export function parseInclusiveDateRangeEnd(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T23:59:59.999Z`);
  }
  return new Date(value);
}
