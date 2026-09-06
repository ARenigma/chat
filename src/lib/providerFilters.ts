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
}

export const NO_FILTER: DirectoryFilter = { category: null, bands: [] };

/** Whether any filter is actually narrowing the list (drives the "clear" affordance). */
export function isFiltering(filter: DirectoryFilter): boolean {
  return filter.category !== null || filter.bands.length > 0;
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
    if (filter.bands.length === 0) {
      return true;
    }
    const band = ageBand(p.age);
    return band !== null && filter.bands.includes(band);
  });
}

/** Toggle one band in a filter, keeping AGE_BANDS order so chips never reorder. */
export function toggleBand(filter: DirectoryFilter, band: AgeBand): DirectoryFilter {
  const has = filter.bands.includes(band);
  const next = has
    ? filter.bands.filter(b => b !== band)
    : AGE_BANDS.filter(b => b === band || filter.bands.includes(b));
  return { ...filter, bands: next };
}
