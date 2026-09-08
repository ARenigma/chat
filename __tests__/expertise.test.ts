import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_EXPERTISE,
  OFFERED_EXPERTISE,
  ROW_EXPERTISE_LIMIT,
  expertiseFor,
  isExpertiseSelected,
  offeredFor,
  rowExpertise,
  toggleExpertise,
} from '../src/lib/expertise';
import type { ProviderSummary } from '../src/lib/database.types';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const provider = (expertise: string[]): Pick<ProviderSummary, 'expertise'> =>
  ({ expertise }) as Pick<ProviderSummary, 'expertise'>;

describe('the offered vocabulary is split the way the roster is', () => {
  it('gives a listener topics and an astrologer disciplines', () => {
    // A single flat list would offer Tarot to a listener or drop it entirely.
    // `provider_category` (065) already splits the directory into two tabs, so
    // this follows a split that exists rather than inventing a second axis.
    expect(expertiseFor('listener')).toContain('Anxiety');
    expect(expertiseFor('listener')).not.toContain('Tarot');
    expect(expertiseFor('astrologer')).toContain('Tarot');
    expect(expertiseFor('astrologer')).not.toContain('Anxiety');
  });

  it('falls back to listener for a category it does not recognise', () => {
    // Same defaulting `categoryOf` does, and for the same reason: a row from an
    // older server must not become unpickable.
    expect(expertiseFor('')).toBe(OFFERED_EXPERTISE.listener);
    expect(expertiseFor('shaman')).toBe(OFFERED_EXPERTISE.listener);
    expect(
      offeredFor({ provider_category: 'astrologer' } as ProviderSummary),
    ).toBe(OFFERED_EXPERTISE.astrologer);
  });

  it('offers more than a row can show, in both columns', () => {
    // If the vocabulary were shorter than the row's cap the cap would never
    // bind, and every test of it below would be vacuous.
    expect(OFFERED_EXPERTISE.listener.length).toBeGreaterThan(ROW_EXPERTISE_LIMIT);
    expect(OFFERED_EXPERTISE.astrologer.length).toBeGreaterThan(ROW_EXPERTISE_LIMIT);
  });

  it('is frozen, so a caller cannot sort the shared array under everyone else', () => {
    expect(Object.isFrozen(OFFERED_EXPERTISE)).toBe(true);
    expect(Object.isFrozen(OFFERED_EXPERTISE.listener)).toBe(true);
    expect(Object.isFrozen(OFFERED_EXPERTISE.astrologer)).toBe(true);
  });

  it('mirrors the ceiling migration 083 enforces', () => {
    /*
     * The form must not be able to build a selection the server refuses with a
     * constraint violation the provider cannot act on. Read out of the
     * migration rather than retyped, which is the same arrangement
     * languagePrefs has with 072.
     */
    const migration = read('supabase/migrations/083_provider_expertise.sql');
    const ceiling = /cardinality\(p\), 0\) <= (\d+)/.exec(migration)?.[1];
    expect(Number(ceiling)).toBe(MAX_EXPERTISE);
    // And it is DIFFERENT from the language ceiling, deliberately — a topic
    // list is a claim, not a capability.
    expect(MAX_EXPERTISE).toBe(8);
  });
});

describe('toggling keeps the offered order, never the tap order', () => {
  const offered = OFFERED_EXPERTISE.listener;

  it('inserts in offered order however it was tapped', () => {
    // A chip row that reorders itself under the finger loses the provider's
    // place in it. Same rule as toggleLanguage and toggleBand.
    let sel: string[] = [];
    sel = toggleExpertise(sel, 'Career', offered);
    sel = toggleExpertise(sel, 'Anxiety', offered);
    sel = toggleExpertise(sel, 'Breakup', offered);
    expect(sel).toEqual(['Anxiety', 'Breakup', 'Career']);
  });

  it('removes case- and whitespace-insensitively', () => {
    // 083's CHECK is a shape floor and permits any value, and the column is
    // writable by the admin console and the seed, so ' anxiety ' is reachable.
    expect(toggleExpertise([' anxiety '], 'Anxiety', offered)).toEqual([]);
    expect(isExpertiseSelected([' anxiety '], 'ANXIETY')).toBe(true);
    expect(isExpertiseSelected(['Anxiety'], 'Stress')).toBe(false);
  });

  it('does nothing at the ceiling rather than evicting the oldest', () => {
    /*
     * Silently dropping a tag the provider chose, to make room for one they
     * just tapped, is a worse answer than the tap doing nothing — the form
     * disables unselected chips at the ceiling so the dead tap is visible
     * before it happens.
     */
    const full = offered.slice(0, MAX_EXPERTISE);
    const next = toggleExpertise(full, offered[MAX_EXPERTISE] as string, offered);
    expect(next).toEqual([...full]);
    expect(next).not.toBe(full); // a copy, never the caller's array
    // Deselecting still works at the ceiling, or it would be a trap.
    expect(toggleExpertise(full, full[0] as string, offered)).toHaveLength(
      MAX_EXPERTISE - 1,
    );
  });

  it('keeps a retired topic rather than dropping a claim somebody made', () => {
    // A topic removed from the vocabulary must not vanish from the selection of
    // a provider who never revisited the form.
    const sel = toggleExpertise(['Astral projection'], 'Anxiety', offered);
    expect(sel).toContain('Astral projection');
    expect(sel).toContain('Anxiety');
    // The unknown sorts after everything offered, so the known ones stay in
    // vocabulary order at the front.
    expect(sel[0]).toBe('Anxiety');
  });
});

describe('what a row shows', () => {
  it('takes the first three, in the provider order', () => {
    expect(
      rowExpertise(provider(['Anxiety', 'Stress', 'Career', 'Sleep'])),
    ).toEqual(['Anxiety', 'Stress', 'Career']);
  });

  it('dedupes on the fold, keeping the first spelling', () => {
    // The column has no uniqueness constraint — 083 bounds the length and the
    // element size and nothing else — so the same tag twice is reachable, and
    // two identical pills is a visible bug.
    expect(rowExpertise(provider(['Anxiety', 'anxiety', ' ANXIETY ', 'Stress']))).toEqual([
      'Anxiety',
      'Stress',
    ]);
  });

  it('drops blank elements instead of rendering an empty pill', () => {
    expect(rowExpertise(provider(['Anxiety', '   ', 'Stress']))).toEqual([
      'Anxiety',
      'Stress',
    ]);
  });

  it('survives a provider with none, and a row from a server without the column', () => {
    /*
     * Two different absences, both real. Empty is a LEGAL provider — 083 makes
     * this no promotion requirement, unlike languages under 075 — and
     * `undefined` is what a client reads from a server that predates the
     * column, which is exactly the skew window the 2026-09-07 incident lived
     * in. Neither may throw, and neither may render a pill.
     */
    expect(rowExpertise(provider([]))).toEqual([]);
    expect(
      rowExpertise({ expertise: undefined } as unknown as Pick<ProviderSummary, 'expertise'>),
    ).toEqual([]);
  });

  it('trims, so a stray space cannot widen a pill', () => {
    expect(rowExpertise(provider(['  Anxiety  ']))).toEqual(['Anxiety']);
  });
});

describe('the provider can actually set their tags', () => {
  const api = read('src/api/provider.ts');
  const form = read('src/screens/ProviderApplicationScreen.tsx');
  const stripped = api
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('writes tags AFTER the role flip, never before', () => {
    /*
     * THE ORDERING IS FORCED, not stylistic, and it is the kind of thing that
     * works on the developer's account (already a provider) and fails for every
     * real applicant.
     *
     * `set_provider_expertise` refuses anyone whose role is not 'provider', and
     * `complete_provider_onboarding` is what sets it. Reversed, this fails every
     * time with "only a provider has expertise" — the correct refusal for a
     * member and the wrong one here.
     */
    const onboard = stripped.indexOf("rpc('complete_provider_onboarding'");
    const tags = stripped.indexOf("rpc('set_provider_expertise'");
    expect(onboard).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(-1);
    expect(tags).toBeGreaterThan(onboard);
  });

  it('does not fail the whole onboarding when only the tags fail', () => {
    /*
     * By the time the second call runs the provider is LIVE — role flipped,
     * directory row present, messageable. Throwing would show "Could not finish
     * setup" to somebody whose setup finished, and invite a retry that re-runs
     * the first call. The row already renders the no-tags case, which is why
     * the seed deliberately includes a provider with none.
     */
    const second = stripped.slice(stripped.indexOf("rpc('set_provider_expertise'"));
    const block = second.slice(0, second.indexOf('},\n    onSuccess'));
    expect(block).toContain('console.warn');
    expect(block).not.toMatch(/throw new Error/);
  });

  it('never blocks Go live on a tag, because the server does not', () => {
    // 083 makes an empty list a legal provider, unlike languages under 075.
    // A client-side requirement the server does not have is a requirement
    // nobody decided on.
    const ready = /const profileReady =([\s\S]*?);\n/.exec(form)?.[1] ?? '';
    expect(ready).toContain('languages.length > 0');
    expect(ready).not.toContain('expertise');
  });

  it('uses the filter chip, not the conversation-starter chip', () => {
    /*
     * `Chip`'s accessibility label is hard-coded to `Start with: ${label}` — it
     * is the opener control. A TalkBack user picking a topic would be told
     * "Start with: Anxiety". `FilterChip` is M3's control for choosing several
     * from a set, and carries the 48dp target and the check.
     */
    const field = form.slice(form.indexOf('testID="provider-expertise"'));
    const block = field.slice(0, field.indexOf('</Field>'));
    expect(block).toContain('<FilterChip');
    expect(block).not.toMatch(/<Chip\b/);
    expect(read('src/components/Chip.tsx')).toContain('Start with: ${label}');
  });

  it('disables the unpicked chips at the ceiling rather than swallowing a tap', () => {
    // `toggleExpertise` returns the selection unchanged at MAX_EXPERTISE, which
    // is right — evicting an earlier choice to make room is worse — but a
    // control that silently ignores a press reads as broken.
    const field = form.slice(form.indexOf('testID="provider-expertise"'));
    const block = field.slice(0, field.indexOf('</Field>'));
    expect(block).toContain('disabled={!picked && expertise.length >= MAX_EXPERTISE}');
  });

  it('offers the topics that match the category the applicant picked', () => {
    expect(form).toContain('expertiseFor(category)');
  });
});

describe('the star row reserves the box the glyph actually renders at', () => {
  /*
   * Amit, on the device: "align the starts below centre of dp -- it seems a
   * bit to the right as of now". Measured before being explained: a pixel scan
   * of the Redmi screenshot put the avatar ring's true centre at x182 and the
   * five-star row's true ink centre at x193 — an ~11px (~4dp) rightward
   * offset, in the direction reported.
   *
   * The cause: `Icon` sets its own Text node's width/height to
   * `Math.round(size * ICON_SCALE)`, not to the `size` prop — so a caller who
   * reserves `size` dp per glyph reserves less than the glyph's real box.
   * RatingStars did exactly that for its WIDTH (but, by luck, not for its
   * height, which already used the same 1.2 factor spelled out by hand) — the
   * empty row of five icons is not width-constrained, so it laid out at its
   * true 5*14+4*1=74dp while the `host` box everything else centres against
   * was fixed at the wrong 5*12+4*1=64dp, and the last star or two silently
   * overflowed the centred box to the right.
   */
  it('exports ICON_SCALE, so a caller can compute the real render box', () => {
    const icon = read('src/components/Icon.tsx');
    expect(icon).toContain('export const ICON_SCALE = 1.2');
    // And Icon's own arithmetic still uses it, so the export cannot drift from
    // what Icon actually does.
    expect(icon).toContain('const px = Math.round(size * ICON_SCALE)');
  });

  it('sizes STARS_WIDTH from the rendered box, not the nominal icon.xs step', () => {
    const stars = read('src/components/RatingStars.tsx');
    expect(stars).toContain(
      'export const STARS_WIDTH = STAR_COUNT * STAR_BOX + (STAR_COUNT - 1) * STAR_GAP',
    );
    expect(stars).toContain('const STAR_BOX = Math.round(STAR * ICON_SCALE)');
    // The two dimensions now come from the SAME constant, which is the
    // invariant that broke: one was scaled and the other was not.
    expect(stars).toContain('export const STARS_HEIGHT = STAR_BOX');

    const star = 12; // TOKENS.icon.xs on this build
    const starBox = Math.round(star * 1.2);
    expect(starBox).toBe(14);
    const starsWidth = 5 * starBox + 4 * 1;
    expect(starsWidth).toBe(74);
    // The old, wrong arithmetic — kept here as the number this gate refuses to
    // regress to, not as a live computation.
    const wrongStarsWidth = 5 * star + 4 * 1;
    expect(wrongStarsWidth).toBe(64);
    expect(starsWidth).not.toBe(wrongStarsWidth);
  });

  it('clips the host, so a future drift shrinks the row instead of shifting it', () => {
    const stars = read('src/components/RatingStars.tsx');
    const host = stars.slice(stars.indexOf('host: {'), stars.indexOf('row: {'));
    expect(host).toContain("overflow: 'hidden'");
  });
});
