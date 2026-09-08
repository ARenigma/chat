import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * Source with its comments removed, for every assertion that BANS a token.
 *
 * Mandatory here, exactly as in providerPhotos.test.ts: ProviderRow.tsx NAMES
 * `nestedScrollEnabled`, `directionalLockEnabled`, `'handled'`, `'never'` and
 * `overflow: 'hidden'` in prose, because each of those comments exists to say
 * why that API is NOT the answer for this row. A raw `not.toContain` would fail
 * on the documentation and pass on nothing.
 *
 * LINE COMMENTS ARE MATCHED ANCHORED TO THE LINE START, not wherever `//`
 * appears. RULE 1 requires a URL beside every platform claim and this file's
 * subject is full of them; a naive /\/\/.*$/ eats the `https://` in
 * `keyboardShouldPersistTaps`'s citation and leaves `https:` behind, which is
 * both a false negative for anything scoped after it and a mangled slice.
 * Block comments go first and wholesale, which is where most of the citations
 * live.
 */
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * A slice bounded by two markers that must both EXIST.
 *
 * The same guard providerPhotos.test.ts spells out: `indexOf` returns -1 for a
 * marker that has been renamed, and `slice(-1)` is not the empty string but the
 * LAST CHARACTER of the file — a one-character string that satisfies every
 * `not.toContain` under it. Both bounds are asserted, and the end marker is
 * searched FROM the start marker.
 */
function between(source: string, from: string, to?: string): string {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  if (to === undefined) {
    return source.slice(start);
  }
  const end = source.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const ROW = 'src/components/ProviderRow.tsx';
const CHIP = 'src/components/MetaChip.tsx';

/** A named style rule from `makeStyles`, comments already stripped. */
const style = (name: string): string => between(code(ROW), `  ${name}: {`, '  },');
/** Everything from `makeStyles` down: the row's layout, and nothing else. */
const rowStyles = (): string => between(code(ROW), 'const makeStyles');

/**
 * REWRITTEN 2026-09-08, and the deletions are the interesting part.
 *
 * This file used to hold four suites about a horizontally-scrolling chip strip
 * and a disclosure chevron: how the strip declined a tap so the row could have
 * it, how Android arbitrated a diagonal drag between the strip and the
 * FlashList, how the chevron got a bounded slot so it stopped eating the text
 * column. Every one of them was a correct test of a real defect.
 *
 * They are gone because the things they guarded are gone. The row was rebuilt
 * on Astrotalk's anatomy (Amit: "astrotalk layout with clarity tags") and the
 * rebuild removed the scroller — expertise tags took the pill line, languages
 * got a full-width line of their own in plain text, and with nothing to scroll
 * there is no three-way gesture to negotiate. The chevron went with it: the CTA
 * says "Chat", which is what the chevron was a mute gesture towards.
 *
 * Deleting a passing test is normally how coverage rots, so the replacement is
 * stated: the invariant those suites really protected is "the row is the same
 * height on every provider and a gesture in it opens the conversation", and
 * that is asserted below against the new layout instead of the old one.
 */
describe('the explore row is Astrotalk anatomy, measured rather than eyeballed', () => {
  it('takes the avatar from the reference, at a size Avatar already has', () => {
    /*
     * 76, from `uiautomator dump` on the Redmi at density 440 (2.75 px/dp):
     * `user_pic` is 72.0dp inside a 76.4dp `background_user_pic`. We do not
     * draw the ring, so our visible circle matches the OUTER one.
     *
     * And 76 is in `Avatar`'s closed size union, which carries hand-tuned FONT
     * and DOT entries per value — 72 would have meant inventing both.
     */
    expect(read(ROW)).toContain('export const ROW_AVATAR = 76');
    const union = /type Size = ([^;]+);/.exec(read('src/components/Avatar.tsx'))?.[1];
    expect(union).toContain('76');
    expect(code(ROW)).toContain('size={ROW_AVATAR}');
  });

  it('stacks the rating under the avatar instead of putting it in the text column', () => {
    // The arrangement that pays for a 76dp avatar: at 40dp the rating had to
    // live among the facts as a chip, competing with them.
    const left = between(code(ROW), '<View style={styles.leftColumn}>', '</View>\n        </View>');
    expect(left).toContain('styles.rating');
    expect(left).toContain('styles.ratingCount');
    // Fixed width, so every row's text column starts on the same x — otherwise
    // the column is as wide as the longest rating count and the separator inset
    // stops being true.
    expect(style('leftColumn')).toContain('width: ROW_AVATAR');
  });

  it('keeps the separator inset derived from the avatar, not retyped', () => {
    // The avatar quadrupled in area; a hand-written inset would now be 36dp
    // wrong and would look like a design choice.
    expect(read(ROW)).toContain('export const ROW_SEPARATOR_INSET = ROW_AVATAR + TOKENS.space.sm');
    expect(style('separator')).toContain('TOKENS.space.md + ROW_SEPARATOR_INSET');
  });

  it('renders no rating count line that changes the row height', () => {
    // Both branches produce a line. A provider with no reviews must occupy the
    // same 16dp as one with a thousand, or the left column measures differently
    // per row and PROVIDER_ROW_HEIGHT is a promise the row does not keep.
    const jsx = code(ROW);
    expect(jsx).toContain("'no ratings yet'");
    expect(jsx).toMatch(/rating_count > 0[\s\S]{0,160}no ratings yet/);
  });
});

describe('the gesture conflict is removed rather than tuned', () => {
  it('has no ScrollView left in the row at all', () => {
    /*
     * The strongest form of the old suite: not "the scroller declines the tap
     * correctly" but "there is no scroller". The previous row nested a
     * horizontal ScrollView inside a Pressable inside a vertical FlashList and
     * needed `keyboardShouldPersistTaps="always"` plus a paragraph of
     * ViewConfiguration reasoning to make a tap reach the row. Amit's report —
     * "schip scroll is not working correctly" — was that arbitration losing.
     *
     * Deleting the scroller deletes the arbitration. This is the assertion that
     * keeps it deleted.
     */
    const body = code(ROW);
    expect(body).not.toContain('ScrollView');
    expect(body).not.toContain('keyboardShouldPersistTaps');
    expect(body).not.toContain('SCROLL_PHYSICS');
    // ...and the recycling rewind that only existed to serve it.
    expect(body).not.toContain('scrollTo');
    expect(body).not.toContain('useRef');
  });

  it('still has exactly two press targets: the row, and the avatar inside it', () => {
    // Unchanged invariant, re-asserted against the new tree. The CTA is a View,
    // not a third Pressable — it performs the row's own action, so a target on
    // top of the row would be a duplicate, and a second TalkBack node for it
    // would be noise. Same argument the chevron lost.
    const body = code(ROW);
    expect(body.match(/<Pressable/g)?.length).toBe(2);
    expect(between(body, 'styles.cta', '</View>')).not.toContain('onPress');
  });

  it('keeps the tag pills out of the accessibility tree', () => {
    // MetaChip is `accessible={false}`; the row's own label carries the tags in
    // words, so a TalkBack user gets them in one utterance rather than as three
    // unlabelled stops.
    expect(code('src/components/MetaChip.tsx')).toContain('accessible={false}');
    expect(code(ROW)).toMatch(/tags\.length > 0 \? tags\.join\(', '\) : null/);
  });
});

describe('the CTA is 48dp, and the reference is the thing that is wrong', () => {
  it('states the departure from the measured 36dp', () => {
    /*
     * Astrotalk's `call_rl` is 36.0×95.3dp on the Redmi. Amit: "48dp". The
     * platform agrees — 48dp is the documented minimum touch target — and
     * unlike the 24dp tag pills, this one really is inside the row's tappable
     * area, so the minimum applies with full force.
     */
    expect(read(ROW)).toContain('export const ROW_CTA_HEIGHT = TOKENS.interaction.minTarget');
    expect(TOKENS.interaction.minTarget).toBe(48);
    // Width follows the reference, since nothing about a width is unsafe.
    expect(read(ROW)).toContain('export const ROW_CTA_WIDTH = 96');
    const cta = style('cta');
    expect(cta).toContain('height: ROW_CTA_HEIGHT');
    expect(cta).toContain('width: ROW_CTA_WIDTH');
  });

  it('quotes one price and never a struck-through one', () => {
    /*
     * Astrotalk renders "₹ 24 ₹ 5/min" with the first crossed out. Amit: "no
     * struck price". We have one rate and it is not discounted, so an anchor
     * price would be invented — the same class of claim as the false per-message
     * cost removed in 75ced47.
     */
    const body = code(ROW);
    expect(body).not.toContain('lineThrough');
    expect(body).not.toContain('textDecorationLine');
    // One rate, formatted through the money formatter rather than interpolated.
    expect(body).toContain('formatRupees(ratePerMin)');
    expect(body.match(/formatRupees\(/g)?.length).toBe(2); // the line and the spoken label
  });

  it('does not promise a call to a provider who has switched calls off', () => {
    // `audio_enabled` is migration 064's provider-owned switch. A phone glyph
    // beside a rate claims the rate buys a call; for a chat-only provider that
    // is a price quoted for something unpurchasable.
    const body = code(ROW);
    expect(body).toContain('const canCall = provider.audio_enabled');
    expect(body).toMatch(/name=\{canCall \? 'call' : 'chat'\}/);
  });
});

describe('every row is still the same height', () => {
  it('cannot grow a fourth tag pill', () => {
    /*
     * Three, and the ceiling is enforced twice on purpose. `ROW_EXPERTISE_LIMIT`
     * caps the array — including the category badge that search prepends, which
     * is why the slice is applied AFTER the concat — and the style clips, so a
     * longer set cannot wrap and push the price line down even if the cap were
     * ever raised without looking here.
     */
    expect(code('src/lib/expertise.ts')).toContain('export const ROW_EXPERTISE_LIMIT = 3');
    expect(code(ROW)).toContain('.slice(0, ROW_EXPERTISE_LIMIT)');
    const line = style('tagLine');
    expect(line).toContain('height: ROW_TAG_LINE');
    expect(line).toContain("overflow: 'hidden'");
    expect(line).not.toContain('flexWrap');
  });

  it('takes the pill height from the chip rather than repeating 24', () => {
    expect(code(CHIP)).toContain('export const META_CHIP_HEIGHT_SM = 24');
    expect(code(ROW)).toContain("import { META_CHIP_HEIGHT_SM, MetaChip } from './MetaChip'");
    expect(code(ROW)).toContain('const ROW_TAG_LINE = META_CHIP_HEIGHT_SM');
  });

  it('computes to 142dp, as the taller of two columns plus its padding', () => {
    /*
     * The row is now TWO columns of different heights, which is the shape the
     * reference uses and the reason the avatar grew. Every term is a token, so
     * a change to the type scale or a chip height fails here rather than
     * silently mis-hinting the list.
     *
     *   left   avatar 76 · 4 · rating 16 · count 16                   = 112
     *   right  name 24 · 2 · tags 24 · 2 · languages 16 · 2 · CTA 48  = 118
     *
     * The last line is a ROW — price left, CTA right — so it costs the CTA's 48
     * rather than 48 plus the price's own 20. Astrotalk does the same: its
     * `call_rl` spans y361.5–397.5, straddling the lines rather than sitting
     * under them.
     *
     * 142 against the reference's 146.2dp `row_content_holder`.
     */
    const smallChip = Number(/export const META_CHIP_HEIGHT_SM = (\d+)/.exec(read(CHIP))?.[1]);
    expect(smallChip).toBe(24);

    const left =
      76 +
      TOKENS.space['2xs'] +
      TOKENS.typography.labelMedium.lineHeight +
      TOKENS.typography.bodySmall.lineHeight;
    const right =
      TOKENS.typography.titleMediumEmphasized.lineHeight +
      TOKENS.space.hair +
      smallChip +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight +
      TOKENS.space.hair +
      TOKENS.interaction.minTarget;
    expect(left).toBe(112);
    expect(right).toBe(118);
    expect(TOKENS.space.sm * 2 + Math.max(left, right)).toBe(142);

    // And the component derives it rather than writing 142 down.
    const src = read(ROW);
    expect(src).toContain('Math.max(PROVIDER_ROW_LEFT_COLUMN, PROVIDER_ROW_RIGHT_COLUMN)');
    expect(src).not.toMatch(/PROVIDER_ROW_HEIGHT = \d/);
  });

  it('and the LIST estimate is that constant, not a copy of the number', () => {
    /*
     * HomeScreen carried `size = 97` in both `overrideItemLayout` callbacks — a
     * value from before the row grew a meta strip, so it had been wrong for as
     * long as the strip existed. FlashList v2 measures real cells, so a wrong
     * hint costs scrollbar and scroll-to-index accuracy rather than
     * correctness, which is precisely why nobody noticed. It is now 45dp wrong
     * instead of 11, which is why pinning the IMPORT matters more than it did.
     */
    const home = code('src/screens/HomeScreen.tsx');
    expect(home).toContain("PROVIDER_ROW_HEIGHT } from '../components/ProviderRow'");
    expect(home.match(/\.size = PROVIDER_ROW_HEIGHT;/g)?.length).toBe(2);
    expect(home).not.toMatch(/\.size = \d+;/);
  });

  it('reads the rate from one place, not once per row', () => {
    /*
     * `ratePerMin` is a prop. `useEconomicsConfig()` inside the row would work —
     * React Query dedupes the fetch — but every visible row would subscribe, so
     * one admin edit re-renders the whole list and `memo` stops holding across
     * balance ticks, which is the exact regression the id-only `onPress`
     * contract was introduced to fix.
     */
    expect(code(ROW)).not.toContain('useEconomicsConfig');
    expect(code(ROW)).toContain('ratePerMin');
    const home = code('src/screens/HomeScreen.tsx');
    expect(home).toContain('useEconomicsConfig()');
    expect(home.match(/ratePerMin=\{ratePerMin\}/g)?.length).toBe(2);
  });

  it('leaves the row itself top-aligned, since the columns differ', () => {
    // `center` would float the 112dp avatar column 3dp down from the name it
    // belongs to. Astrotalk top-aligns for the same reason.
    expect(style('row')).toContain("alignItems: 'flex-start'");
    expect(rowStyles()).not.toContain('rowTwoLine');
  });
});


describe('MetaChip keeps flexing, and that was a decision', () => {
  /*
   * STANDING BAN, and stated as one: this is a review outcome, not a revert of
   * anything. The obvious guard against "a chip squeezed to an ellipsis
   * mid-strip" is `flexShrink: 0` or a `minWidth` on the chip, and both are
   * wrong HERE.
   *
   * ProviderRow no longer squeezes: its strip is a horizontal ScrollView, whose
   * main axis is unbounded, so a chip in it is laid out at its natural width and
   * there is no shrink pressure to ellipsize under. ProviderCard's strip is the
   * opposite — bounded and WRAPPING — and there the default `flexShrink: 1` is
   * the right behaviour for a chip longer than the card is wide: it shrinks and
   * truncates, where `flexShrink: 0` would push it past the card's edge.
   */
  it('adds no flexShrink and no minWidth to the chip', () => {
    const chip = between(code(CHIP), '    chip: {', '    },');
    expect(chip).not.toContain('flexShrink');
    expect(chip).not.toContain('minWidth');
    // The bounded, wrapping call site the ban protects.
    expect(code('src/components/ProviderCard.tsx')).toContain("flexWrap: 'wrap'");
  });
});
