/**
 * How the directory is grouped and filtered, kept pure so the bands and the
 * labels have exactly one definition.
 *
 * Two asks, one module, because they filter the same list (goal items 9 and 12,
 * 2026-09-05): a Listeners / Astrologers tab strip above Explore, and search
 * filters for what someone offers and roughly how old they are.
 *
 * The age bands are computed from `provider_directory.age`, an integer the view
 * has published since 042. Deliberately not a column: a second definition of
 * the boundaries is a second place for them to drift, and the birth date itself
 * never leaves the server either way.
 */
import type { ProviderSummary } from './database.types';

export type ProviderCategory = 'listener' | 'astrologer';

/** Tab order, and the order the filter chips sit in. */
export const PROVIDER_CATEGORIES: readonly ProviderCategory[] = ['listener', 'astrologer'];

/** Every provider was one of these before migration 065, and still defaults to it. */
export const DEFAULT_CATEGORY: ProviderCategory = 'listener';

/**
 * Plural nouns, naming the person rather than the activity (Amit, 2026-09-06).
 * A member is choosing who to talk to, not a service to buy.
 */
export const CATEGORY_LABEL: Record<ProviderCategory, string> = {
  listener: 'Listeners',
  astrologer: 'Astrologers',
};

/** Singular, for a badge on a row that appears in a mixed list (search). */
export const CATEGORY_BADGE: Record<ProviderCategory, string> = {
  listener: 'Listener',
  astrologer: 'Astrologer',
};

export type AgeBand = '18-24' | '25-34' | '35-44' | '45+';

export const AGE_BANDS: readonly AgeBand[] = ['18-24', '25-34', '35-44', '45+'];

/** En-dash for display; the value itself stays ASCII so it is safe as a testID. */
export const AGE_BAND_LABEL: Record<AgeBand, string> = {
  '18-24': '18–24',
  '25-34': '25–34',
  '35-44': '35–44',
  '45+': '45+',
};

/**
 * Which band an age falls in, or null when the directory has no age for them
 * (a provider whose birth date predates the verified-DOB flow). Null is
 * "unknown", never a band — an age filter must not silently invent one.
 */
export function ageBand(age: number | null | undefined): AgeBand | null {
  if (age == null || !Number.isFinite(age) || age < 18) {
    return null;
  }
  if (age < 25) return '18-24';
  if (age < 35) return '25-34';
  if (age < 45) return '35-44';
  return '45+';
}

/** A provider's category, defaulting for a row from a server older than 065. */
export function categoryOf(p: Pick<ProviderSummary, 'provider_category'>): ProviderCategory {
  return p.provider_category === 'astrologer' ? 'astrologer' : DEFAULT_CATEGORY;
}

export interface DirectoryFilter {
  /** Null means every category — what search uses, since the tabs are gone there. */
  category: ProviderCategory | null;
  /** Empty means every age, including providers with no age at all. */
  bands: readonly AgeBand[];
  /**
   * Empty means every language (Amit, 2026-09-08: "give language and expertise
   * filer in search").
   *
   * A FILTER here and a SORT on Home, which looks like an inconsistency and is
   * the product decision. `languagePrefs.ts` opens with it: "sort not filter for
   * language", because on a roster this size a language filter can empty the
   * browse screen, and an empty screen is a worse answer than a well-ordered
   * one. Search is the opposite case — the member has typed a question and
   * asked to narrow, so an empty result is a real answer to it, and a search
   * that quietly widened what was asked for would be worse.
   */
  languages: readonly string[];
  /** Empty means every topic. Same reasoning as `languages` above. */
  expertise: readonly string[];
}

export const NO_FILTER: DirectoryFilter = {
  category: null,
  bands: [],
  languages: [],
  expertise: [],
};

/** Whether any filter is actually narrowing the list (drives the "clear" affordance). */
export function isFiltering(filter: DirectoryFilter): boolean {
  return (
    filter.category !== null ||
    filter.bands.length > 0 ||
    filter.languages.length > 0 ||
    filter.expertise.length > 0
  );
}

/**
 * The list a member should see. Bands are a UNION (picking 25–34 and 35–44
 * means either), which is what a row of chips reads as; category is a single
 * choice, because it is a tab.
 *
 * A provider with no age is excluded once any band is picked: the member has
 * asked a question about age and we cannot answer it for that row.
 */
export function filterProviders(
  rows: readonly ProviderSummary[],
  filter: DirectoryFilter,
): ProviderSummary[] {
  return rows.filter(p => {
    if (filter.category !== null && categoryOf(p) !== filter.category) {
      return false;
    }
    if (!matchesAny(p.languages, filter.languages)) {
      return false;
    }
    // `expertise` can be undefined on a row from a server older than 083 —
    // exactly the skew window the 2026-09-07 incident lived in. Treated as "no
    // topics", so such a provider drops out of a topic search rather than
    // crashing it or being silently included in every one.
    if (!matchesAny(p.expertise, filter.expertise)) {
      return false;
    }
    if (filter.bands.length === 0) {
      return true;
    }
    const band = ageBand(p.age);
    return band !== null && filter.bands.includes(band);
  });
}

/**
 * Case- and whitespace-insensitive matching, for the reason
 * `languagePrefs.fold` gives: the two sides are written by different people.
 * `profiles.languages` and `profiles.expertise` are both shape-checked and not
 * value-checked (072, 083), and both are writable by the admin console and the
 * seed, so ' hindi ' and 'Hindi' are both reachable. A filter that silently
 * failed to match them would look like the feature doing nothing.
 */
function fold(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * ANY, not ALL, for both lists.
 *
 * Picking Hindi and Tamil means "someone I can talk to", not "someone
 * bilingual" — the second reading empties the screen and is not what a row of
 * chips looks like it means. `filterProviders` already reads the age bands as a
 * union for exactly the same reason, so this is the list's existing grammar
 * rather than a new one.
 *
 * ACROSS the two, though, it is AND: Hindi + Anxiety means somebody who speaks
 * Hindi and helps with anxiety. Two separate questions, each narrowing.
 */
function matchesAny(have: readonly string[] | null, want: readonly string[]): boolean {
  if (want.length === 0) {
    return true;
  }
  const held = new Set((have ?? []).map(fold));
  return want.some(w => held.has(fold(w)));
}

/** Toggle one band in a filter, keeping AGE_BANDS order so chips never reorder. */
export function toggleBand(filter: DirectoryFilter, band: AgeBand): DirectoryFilter {
  const has = filter.bands.includes(band);
  const next = has
    ? filter.bands.filter(b => b !== band)
    : AGE_BANDS.filter(b => b === band || filter.bands.includes(b));
  return { ...filter, bands: next };
}

/**
 * Toggle one language in a filter, keeping OFFERED_LANGUAGES order so the chips
 * never reorder under the finger — the same rule as `toggleBand` above and
 * `toggleLanguage` in languagePrefs.ts.
 */
export function toggleFilterLanguage(
  filter: DirectoryFilter,
  language: string,
  offered: readonly string[],
): DirectoryFilter {
  return { ...filter, languages: toggleIn(filter.languages, language, offered) };
}

/** Toggle one topic in a filter. Same rule, same reason. */
export function toggleFilterExpertise(
  filter: DirectoryFilter,
  topic: string,
  offered: readonly string[],
): DirectoryFilter {
  return { ...filter, expertise: toggleIn(filter.expertise, topic, offered) };
}

/**
 * Shared by both toggles above, and NOT shared with `toggleLanguage` in
 * languagePrefs.ts even though the body is nearly identical.
 *
 * That one enforces MAX_PREFERRED_LANGUAGES, because it writes a column the
 * database bounds. This one bounds nothing: a search filter is not stored, so a
 * member ticking every chip is asking a wide question rather than building an
 * invalid row. Sharing the function would have quietly imposed a ceiling on the
 * filter that no rule anywhere justifies.
 */
function toggleIn(
  selected: readonly string[],
  value: string,
  offered: readonly string[],
): string[] {
  const key = fold(value);
  if (selected.some(v => fold(v) === key)) {
    return selected.filter(v => fold(v) !== key);
  }
  const rank = new Map(offered.map((v, i) => [fold(v), i]));
  const unknown = offered.length;
  return [...selected, value]
    .map((v, i) => ({ v, i, r: rank.get(fold(v)) ?? unknown + i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.v);
}
