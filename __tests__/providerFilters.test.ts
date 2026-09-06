import type { ProviderSummary } from '../src/lib/database.types';
import {
  AGE_BANDS,
  AGE_BAND_LABEL,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  NO_FILTER,
  PROVIDER_CATEGORIES,
  ageBand,
  categoryOf,
  filterProviders,
  isFiltering,
  toggleBand,
} from '../src/lib/providerFilters';

const provider = (id: string, age: number | null, category: string): ProviderSummary =>
  ({
    id,
    display_name: id,
    avatar_url: null,
    gender: null,
    age,
    headline: null,
    about: null,
    languages: [],
    is_available: true,
    rating_avg: null,
    rating_count: 0,
    median_reply_seconds: null,
    last_active_at: null,
    created_at: '2026-01-01T00:00:00Z',
    presence: 'here',
    chat_enabled: true,
    audio_enabled: true,
    video_enabled: true,
    provider_category: category,
  }) as unknown as ProviderSummary;

describe('providerFilters: age bands are computed once, from the integer the view publishes', () => {
  it('puts each age in exactly one band, at the boundaries', () => {
    expect(ageBand(18)).toBe('18-24');
    expect(ageBand(24)).toBe('18-24');
    expect(ageBand(25)).toBe('25-34');
    expect(ageBand(34)).toBe('25-34');
    expect(ageBand(35)).toBe('35-44');
    expect(ageBand(44)).toBe('35-44');
    expect(ageBand(45)).toBe('45+');
    expect(ageBand(80)).toBe('45+');
  });

  it('calls an unknown or impossible age unknown, never a band', () => {
    // A provider whose row predates the verified-DOB flow has no age, and a
    // provider under 18 cannot exist (the onboarding RPC refuses them).
    expect(ageBand(null)).toBeNull();
    expect(ageBand(undefined)).toBeNull();
    expect(ageBand(17)).toBeNull();
    expect(ageBand(Number.NaN)).toBeNull();
  });

  it('labels every band it declares', () => {
    for (const band of AGE_BANDS) {
      expect(AGE_BAND_LABEL[band]).toBeTruthy();
    }
    // The values stay ASCII so they are safe in a testID; only labels are typeset.
    expect(AGE_BANDS.every(b => /^[\d+-]+$/.test(b))).toBe(true);
    expect(AGE_BAND_LABEL['18-24']).toBe('18–24');
  });
});

describe('providerFilters: category is a tag with a default', () => {
  it('defaults anything that is not astrologer to listener', () => {
    expect(categoryOf(provider('a', 30, 'astrologer'))).toBe('astrologer');
    expect(categoryOf(provider('b', 30, 'listener'))).toBe('listener');
    // A row from a server older than 065 has no category at all.
    expect(categoryOf(provider('c', 30, undefined as unknown as string))).toBe(DEFAULT_CATEGORY);
    expect(categoryOf(provider('d', 30, 'wizard'))).toBe(DEFAULT_CATEGORY);
  });

  it('labels every category it declares', () => {
    for (const c of PROVIDER_CATEGORIES) {
      expect(CATEGORY_LABEL[c]).toBeTruthy();
    }
    expect(CATEGORY_LABEL.listener).toBe('Listeners');
    expect(CATEGORY_LABEL.astrologer).toBe('Astrologers');
  });
});

describe('providerFilters: filtering the directory', () => {
  const rows = [
    provider('young-listener', 22, 'listener'),
    provider('mid-listener', 31, 'listener'),
    provider('mid-astro', 33, 'astrologer'),
    provider('old-astro', 52, 'astrologer'),
    provider('ageless', null, 'listener'),
  ];

  it('returns everything with no filter', () => {
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(filterProviders(rows, NO_FILTER)).toHaveLength(5);
  });

  it('narrows by category, keeping providers with no age', () => {
    expect(filterProviders(rows, { category: 'astrologer', bands: [] }).map(p => p.id)).toEqual([
      'mid-astro',
      'old-astro',
    ]);
    expect(filterProviders(rows, { category: 'listener', bands: [] }).map(p => p.id)).toEqual([
      'young-listener',
      'mid-listener',
      'ageless',
    ]);
  });

  it('treats several bands as a union, and drops the ageless once age is asked about', () => {
    expect(filterProviders(rows, { category: null, bands: ['18-24', '45+'] }).map(p => p.id)).toEqual(
      ['young-listener', 'old-astro'],
    );
    expect(filterProviders(rows, { category: null, bands: ['25-34'] }).map(p => p.id)).toEqual([
      'mid-listener',
      'mid-astro',
    ]);
    expect(filterProviders(rows, { category: null, bands: AGE_BANDS }).map(p => p.id)).not.toContain(
      'ageless',
    );
  });

  it('combines both, and can return nothing', () => {
    expect(
      filterProviders(rows, { category: 'astrologer', bands: ['18-24'] }),
    ).toEqual([]);
    expect(
      filterProviders(rows, { category: 'astrologer', bands: ['45+'] }).map(p => p.id),
    ).toEqual(['old-astro']);
  });

  it('toggles bands without reordering the chips', () => {
    let f = toggleBand(NO_FILTER, '45+');
    expect(f.bands).toEqual(['45+']);
    f = toggleBand(f, '18-24');
    // Declaration order, not tap order.
    expect(f.bands).toEqual(['18-24', '45+']);
    expect(isFiltering(f)).toBe(true);
    f = toggleBand(f, '45+');
    expect(f.bands).toEqual(['18-24']);
    f = toggleBand(f, '18-24');
    expect(f.bands).toEqual([]);
    expect(isFiltering(f)).toBe(false);
  });
});
