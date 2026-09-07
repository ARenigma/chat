import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderSummary } from '../src/lib/database.types';
import {
  MAX_PREFERRED_LANGUAGES,
  OFFERED_LANGUAGES,
  isLanguageSelected,
  languageMatchCount,
  sortByLanguageMatch,
  toggleLanguage,
} from '../src/lib/languagePrefs';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Comments removed, string and template literals preserved.
 *
 * Duplicated rather than imported, which is this repo's convention: importing
 * another `*.test.ts` re-registers that file's `describe` blocks inside this
 * suite, because jest's `testMatch` makes every file in `__tests__` a suite.
 *
 * Quote- and URL-aware, and that is not a nicety here. The files this block
 * grades carry `https://` doc citations and `//`-prefixed URLs inside comments;
 * a naive `//` rule would delete the citations RULE 1 requires and then grade
 * the wreckage. It also means a claim made in PROSE cannot satisfy a gate —
 * `languagePrefs.ts`'s own header says "sort not filter", and that sentence
 * must not be what makes the assertion below pass.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c + (d ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

const provider = (id: string, languages: string[]): ProviderSummary =>
  ({
    id,
    display_name: id,
    avatar_url: null,
    gender: null,
    age: 30,
    headline: null,
    about: null,
    languages,
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
    provider_category: 'listener',
  }) as unknown as ProviderSummary;

describe('the offered set comes from what a provider can actually claim', () => {
  it('is exactly the provider application form\'s list, in its order', () => {
    /*
     * The drift gate, and the reason this file reads source text at all.
     *
     * `LANGUAGES` in ProviderApplicationScreen is the only place that decides
     * what goes into `profiles.languages`, and therefore the only set a match
     * can ever be found in. If it grows a seventh language and this list does
     * not, the member is never offered a language that providers now speak —
     * a silent hole with no type error and no runtime failure, only a sort that
     * quietly cannot see somebody.
     *
     * Bounded to the declaration rather than the file, and read from stripped
     * source, so a language named only in a comment cannot satisfy it.
     */
    const form = stripComments(read('src/screens/ProviderApplicationScreen.tsx'));
    const match = form.match(/const LANGUAGES\s*=\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const declared = (match?.[1] ?? '')
      .split(',')
      .map(s => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);
    expect(declared.length).toBeGreaterThan(0);
    expect([...OFFERED_LANGUAGES]).toEqual(declared);
  });

  it('covers every language the dev seed gives a provider', () => {
    /*
     * The seed is a SUBSET of the form's list and not the source of it (Telugu
     * is offered and has no seeded speaker), so this asserts containment in one
     * direction only. It still catches the case that matters: a seeded provider
     * speaking a language no member can ask for is a provider the sort can
     * never promote, on the only dataset anyone develops against.
     */
    const seed = read('scripts/seed-dev.sql');
    const seeded = new Set(
      [...seed.matchAll(/array\[([^\]]*)\]/g)]
        .flatMap(m => (m[1] ?? '').split(','))
        .map(s => s.trim().replace(/'/g, ''))
        .filter(s => /^[A-Z][a-z]+$/.test(s)),
    );
    expect(seeded.size).toBeGreaterThan(0);
    for (const language of seeded) {
      expect(OFFERED_LANGUAGES).toContain(language);
    }
  });

  it('caps the selection at the number migration 072 enforces', () => {
    // The client must not be able to build a selection the server refuses with
    // a constraint violation the member cannot act on.
    const migration = read('supabase/migrations/072_member_language_preferences.sql');
    expect(migration).toContain(`<= ${MAX_PREFERRED_LANGUAGES}`);
    expect(MAX_PREFERRED_LANGUAGES).toBeGreaterThan(OFFERED_LANGUAGES.length);
  });
});

describe('toggling keeps the chip row still', () => {
  it('adds and removes, in declaration order rather than tap order', () => {
    let s = toggleLanguage([], 'Marathi');
    expect(s).toEqual(['Marathi']);
    s = toggleLanguage(s, 'English');
    // Declaration order (English is first in OFFERED_LANGUAGES), not tap order.
    expect(s).toEqual(['English', 'Marathi']);
    s = toggleLanguage(s, 'Tamil');
    expect(s).toEqual(['English', 'Tamil', 'Marathi']);
    s = toggleLanguage(s, 'Tamil');
    expect(s).toEqual(['English', 'Marathi']);
  });

  it('is case- and whitespace-insensitive on the way out', () => {
    // A preference written by an older client, or by the admin console.
    expect(toggleLanguage([' hindi '], 'Hindi')).toEqual([]);
    expect(isLanguageSelected([' hindi '], 'Hindi')).toBe(true);
    expect(isLanguageSelected(['Hindi'], 'Tamil')).toBe(false);
  });

  it('never returns the array it was given', () => {
    // The caller holds this in React state; mutating in place would not
    // re-render, which is the classic way a chip row stops responding.
    const before: readonly string[] = ['Hindi'];
    expect(toggleLanguage(before, 'Tamil')).not.toBe(before);
    expect(toggleLanguage(before, 'Hindi')).not.toBe(before);
    expect(before).toEqual(['Hindi']);
  });

  it('refuses to grow past the database ceiling', () => {
    const full = Array.from({ length: MAX_PREFERRED_LANGUAGES }, (_, i) => `L${i}`);
    expect(toggleLanguage(full, 'Hindi')).toHaveLength(MAX_PREFERRED_LANGUAGES);
    // Removal still works at the ceiling, or a full selection would be a trap.
    expect(toggleLanguage(full, 'L0')).toHaveLength(MAX_PREFERRED_LANGUAGES - 1);
  });

  it('keeps a selection that is no longer offered', () => {
    // A language retired from the provider form must not silently drop a
    // preference the member never went back to.
    const s = toggleLanguage(['Konkani'], 'Hindi');
    expect(s).toContain('Konkani');
    expect(s).toContain('Hindi');
    // The offered one sorts ahead of the unknown one.
    expect(s).toEqual(['Hindi', 'Konkani']);
  });
});

describe('the ranking rule', () => {
  it('counts how many of the member\'s languages a provider speaks', () => {
    const p = provider('p', ['Hindi', 'Tamil', 'English']);
    expect(languageMatchCount(p, ['Hindi', 'Tamil', 'Bengali'])).toBe(2);
    expect(languageMatchCount(p, ['Bengali'])).toBe(0);
    expect(languageMatchCount(p, [])).toBe(0);
  });

  it('does not let a duplicate on the provider row score twice', () => {
    // `profiles.languages` has no uniqueness constraint.
    expect(languageMatchCount(provider('p', ['Hindi', 'hindi']), ['Hindi'])).toBe(1);
  });

  it('scores a provider with no languages at zero rather than throwing', () => {
    expect(languageMatchCount(provider('p', []), ['Hindi'])).toBe(0);
    expect(
      languageMatchCount(
        { languages: undefined as unknown as string[] },
        ['Hindi'],
      ),
    ).toBe(0);
  });
});

describe('sorting the directory by language', () => {
  /*
   * The incoming order IS the tie-break, and it is the order the server
   * already gives: `useProviders` asks for `is_available desc, created_at asc`.
   * So this fixture is written in that order deliberately — the assertions
   * below are about what the sort does to it, not about what it should have
   * been.
   */
  const rows = [
    provider('two-of-three', ['Hindi', 'Tamil']),
    provider('none', ['Bengali', 'Marathi']),
    provider('one-of-three-early', ['English']),
    provider('speechless', []),
    provider('one-of-three-late', ['Hindi', 'Marathi', 'Telugu']),
    provider('three-of-three', ['English', 'Hindi', 'Tamil', 'Telugu']),
  ];
  const selected = ['English', 'Hindi', 'Tamil'];

  it('puts more matches first', () => {
    expect(sortByLanguageMatch(rows, selected).map(p => p.id)).toEqual([
      'three-of-three',
      'two-of-three',
      // Both match exactly one, so they keep the order they arrived in —
      // 'early' was ahead of 'late' in the input and still is.
      'one-of-three-early',
      'one-of-three-late',
      // Zero matches. 'none' speaks two languages and 'speechless' speaks none;
      // neither is promoted over the other, and neither is dropped.
      'none',
      'speechless',
    ]);
  });

  it('ranks two matches above one, and one above none', () => {
    const order = sortByLanguageMatch(rows, selected).map(p => p.id);
    expect(order.indexOf('two-of-three')).toBeLessThan(
      order.indexOf('one-of-three-early'),
    );
    expect(order.indexOf('one-of-three-late')).toBeLessThan(order.indexOf('none'));
  });

  it('NEVER filters: every row that went in comes out, on every case', () => {
    /*
     * The product decision, asserted rather than described (Amit, 2026-09-07:
     * "sort not filter for language"). On a roster this size a language filter
     * can empty the screen, so the length is checked for a matching selection,
     * a non-matching one, an empty one, and a selection of a language nobody
     * speaks.
     */
    for (const sel of [
      selected,
      [],
      ['Bengali'],
      ['Klingon'],
      ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi'],
    ]) {
      const out = sortByLanguageMatch(rows, sel);
      expect(out).toHaveLength(rows.length);
      expect(new Set(out.map(p => p.id))).toEqual(new Set(rows.map(p => p.id)));
    }
  });

  it('leaves the order completely alone when nothing is selected', () => {
    // The empty selection's defined behaviour: the directory as it is today.
    expect(sortByLanguageMatch(rows, []).map(p => p.id)).toEqual(
      rows.map(p => p.id),
    );
    // And when the selection matches nobody, which is the same case arrived at
    // from the other direction.
    expect(sortByLanguageMatch(rows, ['Klingon']).map(p => p.id)).toEqual(
      rows.map(p => p.id),
    );
  });

  it('does not mutate or alias the array it was given', () => {
    const input = [...rows];
    const out = sortByLanguageMatch(input, selected);
    expect(out).not.toBe(input);
    expect(input.map(p => p.id)).toEqual(rows.map(p => p.id));
    // Also for the short-circuit path, which returns a copy rather than `rows`.
    expect(sortByLanguageMatch(input, [])).not.toBe(input);
  });

  it('matches across case and stray whitespace on both sides', () => {
    // The provider side is typed by a provider; the member side may have come
    // from an older client. Neither is normalised at rest.
    const mixed = [provider('a', ['bengali']), provider('b', [' Hindi '])];
    expect(sortByLanguageMatch(mixed, ['hindi']).map(p => p.id)).toEqual(['b', 'a']);
  });

  it('is stable enough to be deterministic across repeated calls', () => {
    // A directory that reshuffles under the eye reads as broken — the same
    // argument `topPicks` makes in HomeScreen.
    const once = sortByLanguageMatch(rows, selected).map(p => p.id);
    const twice = sortByLanguageMatch(sortByLanguageMatch(rows, selected), selected)
      .map(p => p.id);
    expect(twice).toEqual(once);
  });
});

describe('Home sorts and does not filter', () => {
  const home = stripComments(read('src/screens/HomeScreen.tsx'));

  it('has a slice to assert against', () => {
    // An empty read makes every assertion below pass vacuously — the trap this
    // repo has shipped four times.
    expect(home.length).toBeGreaterThan(1000);
    expect(home).toContain('sortByLanguageMatch');
  });

  it('feeds the member\'s own preference into the directory order', () => {
    expect(home).toContain('preferred_languages');
    expect(home).toMatch(/sortByLanguageMatch\(\s*\n?\s*filterProviders\(/);
  });

  it('leaves the existing language FILTER chips alone', () => {
    /*
     * Sorting is the default; filtering stays the thing a member does when they
     * have actively decided to hide people. So the search path must still call
     * `filterProviders` with the chip filter, and the language preference must
     * not have been wired into it.
     */
    expect(home).toContain('filterProviders(allProviders, searchFilter)');
    const at = home.indexOf('filterProviders(allProviders, searchFilter)');
    expect(at).toBeGreaterThan(0);
    // Nothing language-preference-shaped within the search narrowing.
    const search = home.slice(at, at + 400);
    expect(search).not.toContain('preferredLanguages');
    expect(search).not.toContain('sortByLanguageMatch');
  });
});

describe('the onboarding step is a step, not a screen', () => {
  const screen = stripComments(read('src/screens/OnboardingScreen.tsx'));

  it('has a slice to assert against', () => {
    expect(screen.length).toBeGreaterThan(1000);
    expect(screen).toContain('language-continue');
  });

  it('adds no navigation, per ADR-0016', () => {
    /*
     * The binding constraint: onboarding is ONE screen with stacked steps.
     * `onboarding.test.ts` already gates the whole file against a navigator;
     * this is the same claim from the language step's side, so a future edit
     * that reached for a route to hold six chips fails here too.
     */
    expect(screen).not.toContain('navigation.navigate');
    expect(screen).not.toContain('createNativeStackNavigator');
  });

  it('renders the M3 filter chip rather than a fourth chip', () => {
    expect(screen).toContain('<FilterChip');
    expect(screen).toContain("from '../components/Chip'");
  });

  it('drives the row from the shared offered list, not a local literal', () => {
    expect(screen).toMatch(/OFFERED_LANGUAGES\.map\(/);
    // A hard-coded list here would be the drift the gate above cannot see.
    expect(screen).not.toMatch(/\[\s*'English',\s*'Hindi'/);
  });

  it('does not auto-advance, unlike the single-choice age row', () => {
    /*
     * A multi-select that submits on the first tap makes the second language
     * unreachable. The age chips DO auto-advance (one choice, so the tap is the
     * answer) and their block is still expected to — this asserts the two blocks
     * really do behave differently rather than one having been copied.
     */
    const at = screen.indexOf('<FilterChip');
    const block = screen.slice(at, screen.indexOf('language-continue', at));
    expect(at).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain('onToggle={onToggleLanguage}');
    expect(block).not.toContain('setPreferredLanguages');
    // The age row's auto-advance is unchanged.
    expect(screen).toMatch(/void setMemberAgeBracket\(bracket\)/);
  });

  it('offers a defined way past it with nothing selected', () => {
    // Skippable is the decision; a step with no exit for an empty selection
    // would make an optional preference a gate.
    expect(screen).toContain('Skip for now');
    expect(screen).toMatch(/languages\.length === 0/);
  });
});
