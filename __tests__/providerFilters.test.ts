import type { ProviderSummary } from '../src/lib/database.types';
import {
  AGE_BANDS,
  AGE_BAND_LABEL,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  NO_FILTER,
  toggleFilterLanguage,
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
    expect(filterProviders(rows, { ...NO_FILTER, category: 'astrologer', bands: [] }).map(p => p.id)).toEqual([
      'mid-astro',
      'old-astro',
    ]);
    expect(filterProviders(rows, { ...NO_FILTER, category: 'listener', bands: [] }).map(p => p.id)).toEqual([
      'young-listener',
      'mid-listener',
      'ageless',
    ]);
  });

  it('treats several bands as a union, and drops the ageless once age is asked about', () => {
    expect(filterProviders(rows, { ...NO_FILTER, category: null, bands: ['18-24', '45+'] }).map(p => p.id)).toEqual(
      ['young-listener', 'old-astro'],
    );
    expect(filterProviders(rows, { ...NO_FILTER, category: null, bands: ['25-34'] }).map(p => p.id)).toEqual([
      'mid-listener',
      'mid-astro',
    ]);
    expect(filterProviders(rows, { ...NO_FILTER, category: null, bands: AGE_BANDS }).map(p => p.id)).not.toContain(
      'ageless',
    );
  });

  it('combines both, and can return nothing', () => {
    expect(
      filterProviders(rows, { ...NO_FILTER, category: 'astrologer', bands: ['18-24'] }),
    ).toEqual([]);
    expect(
      filterProviders(rows, { ...NO_FILTER, category: 'astrologer', bands: ['45+'] }).map(p => p.id),
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

describe('search narrows by language and by topic', () => {
  /*
   * Amit, 2026-09-08: "give language and expertise filer in search".
   *
   * A FILTER here where Home SORTS by the same field, which looks like an
   * inconsistency and is the product decision. languagePrefs.ts opens with it —
   * "sort not filter for language" — because on a roster this size a language
   * filter can empty the browse screen. Search is the opposite case: the member
   * has typed a question and asked to narrow, so an empty result is a real
   * answer, and quietly widening what they asked for would be worse.
   */
  const person = (
    id: string,
    languages: string[],
    expertise: string[],
  ): ProviderSummary =>
    ({
      id,
      display_name: id,
      languages,
      expertise,
      age: 30,
      provider_category: 'listener',
    }) as unknown as ProviderSummary;

  const rows = [
    person('hindi-anxiety', ['Hindi'], ['Anxiety']),
    person('tamil-career', ['Tamil'], ['Career']),
    person('both', ['Hindi', 'Tamil'], ['Anxiety', 'Sleep']),
    person('untagged', ['English'], []),
  ];

  it('matches ANY of the picked languages, not all of them', () => {
    // Picking Hindi and Tamil means "someone I can talk to", not "someone
    // bilingual". The second reading empties the screen and is not what a row
    // of chips looks like it means — the age bands already read as a union for
    // exactly this reason.
    const got = filterProviders(rows, {
      ...NO_FILTER,
      languages: ['Hindi', 'Tamil'],
    }).map(p => p.id);
    expect(got).toEqual(['hindi-anxiety', 'tamil-career', 'both']);
  });

  it('matches ANY of the picked topics', () => {
    const got = filterProviders(rows, {
      ...NO_FILTER,
      expertise: ['Anxiety'],
    }).map(p => p.id);
    expect(got).toEqual(['hindi-anxiety', 'both']);
  });

  it('but ANDs across the two, because they are separate questions', () => {
    // Hindi + Anxiety means somebody who speaks Hindi AND helps with anxiety.
    const got = filterProviders(rows, {
      ...NO_FILTER,
      languages: ['Tamil'],
      expertise: ['Anxiety'],
    }).map(p => p.id);
    expect(got).toEqual(['both']);
  });

  it('folds case and whitespace on both sides', () => {
    // 072 and 083 are shape floors, not value allowlists, and both columns are
    // writable by the admin console and the seed — so ' hindi ' is reachable. A
    // filter that silently failed to match it would look like the feature doing
    // nothing.
    const odd = [person('odd', [' hindi '], ['ANXIETY'])];
    expect(
      filterProviders(odd, { ...NO_FILTER, languages: ['Hindi'] }),
    ).toHaveLength(1);
    expect(
      filterProviders(odd, { ...NO_FILTER, expertise: ['Anxiety'] }),
    ).toHaveLength(1);
  });

  it('drops a provider with no tags from a topic search, and never crashes on one', () => {
    /*
     * Two absences, both real: an empty array is a legal provider (083 makes
     * tags optional), and `undefined` is what a client reads from a server
     * older than 083 — the skew window the 2026-09-07 incident lived in.
     * Neither may throw, and neither may match a topic nobody claimed.
     */
    expect(
      filterProviders(rows, { ...NO_FILTER, expertise: ['Anxiety'] }).map(p => p.id),
    ).not.toContain('untagged');
    const legacy = [
      { ...person('legacy', ['Hindi'], []), expertise: undefined } as unknown as ProviderSummary,
    ];
    expect(() =>
      filterProviders(legacy, { ...NO_FILTER, expertise: ['Anxiety'] }),
    ).not.toThrow();
    expect(filterProviders(legacy, { ...NO_FILTER, expertise: ['Anxiety'] })).toHaveLength(0);
    // ...and it is still findable when the topic filter is not being used.
    expect(filterProviders(legacy, NO_FILTER)).toHaveLength(1);
  });

  it('counts as filtering, so the clear affordance appears', () => {
    expect(isFiltering({ ...NO_FILTER, languages: ['Hindi'] })).toBe(true);
    expect(isFiltering({ ...NO_FILTER, expertise: ['Anxiety'] })).toBe(true);
    expect(isFiltering(NO_FILTER)).toBe(false);
  });

  it('toggles in the offered order, never in tap order', () => {
    // A chip row that reorders under the finger loses the member's place in it.
    const offered = ['English', 'Hindi', 'Tamil'];
    let f = NO_FILTER;
    f = toggleFilterLanguage(f, 'Tamil', offered);
    f = toggleFilterLanguage(f, 'English', offered);
    expect(f.languages).toEqual(['English', 'Tamil']);
    f = toggleFilterLanguage(f, 'English', offered);
    expect(f.languages).toEqual(['Tamil']);
  });

  it('imposes no ceiling, because a search filter is not a stored column', () => {
    /*
     * `toggleLanguage` in languagePrefs.ts caps at MAX_PREFERRED_LANGUAGES
     * because it writes a column the database bounds. Sharing that function
     * here would have quietly imposed a limit on the filter that no rule
     * anywhere justifies — a member ticking every chip is asking a wide
     * question, not building an invalid row.
     */
    const offered = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi'];
    let f = NO_FILTER;
    for (const l of offered) {
      f = toggleFilterLanguage(f, l, offered);
    }
    expect(f.languages).toEqual(offered);
  });
});
