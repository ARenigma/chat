/**
 * Search matching and debouncing.
 *
 * Two bugs were reported as one sentence: "search starts searching with first
 * letter input only, fix this search completely". The first half is the debounce,
 * the second is that it only ever searched existing conversations. These cover
 * the pure half; a contract test covers the screen wiring.
 */
import { matchesQuery, normaliseQuery, SEARCH_DEBOUNCE_MS } from '../src/lib/search';

describe('normaliseQuery', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseQuery('  Aditi   Sharma ')).toBe('aditi sharma');
  });

  it('treats whitespace-only input as no query', () => {
    expect(normaliseQuery('   ')).toBe('');
    expect(normaliseQuery('\n\t')).toBe('');
  });
});

describe('matchesQuery', () => {
  it('matches a substring anywhere, not just a prefix', () => {
    // People search for the distinctive part of a name, not its beginning.
    expect(matchesQuery(['Aditi Sharma'], 'sharma')).toBe(true);
    expect(matchesQuery(['Aditi Sharma'], 'iti')).toBe(true);
  });

  it('is true for an empty query, so clearing the field restores everything', () => {
    expect(matchesQuery(['anything'], '')).toBe(true);
    expect(matchesQuery([null, undefined], '')).toBe(true);
  });

  it('skips null and undefined rather than coercing them', () => {
    // The bug this prevents: a provider with no headline matching the query
    // "null", which is exactly what string interpolation would have produced.
    expect(matchesQuery([null, undefined], 'null')).toBe(false);
    expect(matchesQuery([null, 'undefined headline'], 'undefined')).toBe(true);
  });

  it('searches every field it is given', () => {
    expect(matchesQuery(['Aditi', 'here to listen'], 'listen')).toBe(true);
    expect(matchesQuery(['Aditi', 'here to listen'], 'absent')).toBe(false);
  });
});

describe('the debounce interval', () => {
  it('is long enough to outlast a fast keystroke burst', () => {
    // Below roughly 150ms you are filtering per letter again, which is the bug.
    // Much above 400ms and the list feels detached from the field.
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(150);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(400);
  });
});
