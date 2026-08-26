/**
 * Search matching and debouncing, kept pure and free of react-native.
 *
 * Two problems were reported as one: the field filtered on the first keystroke,
 * and it only ever searched conversations you already had. The first is fixed by
 * `useDebouncedQuery`, the second by the caller searching both lists. Both fixes
 * live here rather than in the screen so they can be tested without a device.
 */
import { useEffect, useState } from 'react';

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

/**
 * The value the list should filter on, trailing the value the field displays.
 *
 * Returns the normalised query, so callers never repeat the folding. The input
 * itself stays fully controlled by the caller: nothing here delays a keystroke
 * appearing, only the work that follows it.
 *
 * An empty query short-circuits with no timer, so clearing the field restores the
 * full list immediately. Waiting 250ms to show everything again would read as the
 * app being slow at the one moment the user is asking it to do less.
 */
export function useDebouncedQuery(raw: string, ms: number = SEARCH_DEBOUNCE_MS): string {
  const target = normaliseQuery(raw);
  const [settled, setSettled] = useState(target);

  useEffect(() => {
    if (target === '') {
      setSettled('');
      return;
    }
    const timer = setTimeout(() => setSettled(target), ms);
    return () => clearTimeout(timer);
  }, [target, ms]);

  return settled;
}
