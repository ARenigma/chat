/**
 * Search matching and debouncing, kept pure and free of react-native.
 *
 * Two problems were reported as one: the field filtered on the first keystroke,
 * and it only ever searched conversations you already had. The first is fixed by
 * `useDebouncedQuery`, the second by the caller searching both lists. Both fixes
 * live here rather than in the screen so they can be tested without a device.
 */

/**
 * How long typing has to settle before the list re-filters.
 *
 * 250ms is the usual floor for "they stopped typing" without feeling laggy:
 * comfortably longer than the ~120ms gap between keystrokes in a fast burst, and
 * short enough that it reads as instant once the finger lifts. Below about 150ms
 * you are back to filtering per letter, which is the bug.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Case-folded and whitespace-collapsed. Returns `''` for anything with no
 * searchable content, which callers treat as "no query" rather than "no results".
 */
export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether any field contains the query.
 *
 * Substring rather than prefix, because people search for the distinctive part of
 * a name rather than its beginning. Null and undefined fields are skipped instead
 * of being coerced, so a missing headline cannot match the string "null".
 */
export function matchesQuery(fields: readonly (string | null | undefined)[], q: string): boolean {
  if (q === '') {
    return true;
  }
  return fields.some(field => typeof field === 'string' && field.toLowerCase().includes(q));
}

