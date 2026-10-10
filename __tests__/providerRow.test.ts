import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';
import { genderLetter, providerCtaLabel } from '../src/lib/display';
import { ICON_GLYPH } from '../src/theme/icons.generated';
import { capHeight, cmapOf, glyphBounds, unitsPerEm } from './helpers/ttf';

/*
 * NOTHING IN src/components CAN BE IMPORTED HERE, and that is why every gate in
 * this file is a source scan rather than a call.
 *
 * `ProviderRow.tsx` imports `react-native-reanimated`, which throws
 * `TypeError: Cannot read properties of undefined (reading
 * 'loadUnpackersWithCode')` under jest — there is no renderer in
 * devDependencies, so the native worklets module has nothing to install into.
 * An attempt to import PROVIDER_CARD_HEIGHT for the height test failed exactly
 * that way on 2026-09-08.
 *
 * The consequence for the height assertions below: the expected value is
 * recomputed from tokens, AND the component's own formula is asserted as TEXT.
 * The recomputation alone is what let the previous version pass while
 * describing a row that no longer existed — it agreed with itself and never
 * read the file.
 *
 * `genderLetter` moved to src/lib/display.ts precisely so it could be CALLED.
 */

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
    expect(read(ROW)).toContain('const ROW_AVATAR = 76');
    const union = /type Size = ([^;]+);/.exec(read('src/components/Avatar.tsx'))?.[1];
    expect(union).toContain('76');
    expect(code(ROW)).toContain('size={ROW_AVATAR}');
  });

  it('stacks the stars and the review count under the avatar', () => {
    /*
     * Astrotalk's `average_ratingbar` (80×16dp) and its "10k+ orders" line both
     * sit under the photo, not in the text column — and that arrangement is
     * what pays for a 76dp avatar. At 40dp the rating had to live among the
     * facts as a chip, competing with them.
     */
    const left = between(code(ROW), '<View style={styles.leftColumn}>', '</View>\n\n        {');
    expect(left).toContain('<RatingStars');
    expect(left).toContain('formatReviewCount');
    // Fixed width AND height, so every card's text column starts on the same x
    // and the column cannot swallow its own children — see the avatar-box test.
    expect(style('leftColumn')).toContain('width: ROW_AVATAR_RING');
    expect(style('leftColumn')).toContain('height: PROVIDER_ROW_LEFT_COLUMN');
  });

  it('lands the stars on the last text line, the way the reference does', () => {
    /*
     * Astrotalk's `average_ratingbar` sits at y384.4 and its `price` at y386.5
     * — two points apart, so the rating and the line beside it read as one
     * line across the card. Amit, on the device: "strats should align with
     * rate.. pls see how astrotalsk proved space and alignment".
     *
     * Achieved structurally rather than by a tuned offset: the left column
     * pushes exactly two children apart, so the ring pins to the top and the
     * rating block to the bottom, and its HEIGHT is derived. A hardcoded
     * `marginTop` would have produced the same pixels today and drifted the
     * first time a line was added to the other side.
     *
     * Since 2026-09-27 the line beside the stars is the category (the CTA moved
     * up beside Exp and the category), and the height is the larger of two
     * terms: exact alignment, or Amit's 8dp under the ring. Exact alignment
     * would leave the ring 6.5 clear, so the floor wins and the stars sit 1.5
     * under the category line's centre, inside the 2dp this card has always
     * allowed (it was 111 against 112 at the 136dp column):
     *   category centre = (24+4+16+4+16+4+16+4) + 19/2 = 97.5
     *   aligned column  = 97.5 + 14/2 + 4 + 16          = 124.5  (ring gap 6.5)
     *   floor column    = 84 + 8 + 14 + 4 + 16          = 126    (in force)
     *   stars centre    = 126 − (14 + 4 + 16) + 14/2    = 99
     */
    const left = style('leftColumn');
    expect(left).toContain("justifyContent: 'space-between'");
    // Exactly two children, or space-between distributes something else.
    const column = between(code(ROW), '<View style={styles.leftColumn}>', '</View>\n\n        {');
    expect(column.match(/<Pressable/g)?.length).toBe(1);
    expect(column).toContain('styles.ratingBlock');
    expect(column.match(/<View style=\{styles\.ratingBlock\}>/g)?.length).toBe(1);
    // The ring no longer carries its own bottom margin: the distribution owns
    // that gap now, and two mechanisms for one space is how they disagree.
    expect(style('ring')).not.toContain('marginBottom');

    const gap = TOKENS.space['2xs'];
    const line = TOKENS.typography.bodySmall.lineHeight;
    const categoryLine = Math.round(TOKENS.icon.sm * 1.2);
    const starsHeight = Math.round(TOKENS.icon.xs * 1.2);
    const ring = 76 + 2 * (2 + 2);
    const ratingBlock = starsHeight + gap + line;
    const right =
      TOKENS.typography.textXlSemiBold.lineHeight + (gap + line) * 3 + gap + categoryLine;
    const lastLineCentre = right - categoryLine / 2;
    const aligned = lastLineCentre + starsHeight / 2 + gap + line;
    const floor = ring + TOKENS.space.xs + starsHeight + gap + line;
    const leftHeight = Math.max(aligned, floor);
    const starsCentre = leftHeight - ratingBlock + starsHeight / 2;
    expect(lastLineCentre).toBe(97.5);
    expect(aligned).toBe(124.5);
    expect(floor).toBe(126);
    expect(starsCentre).toBe(99);
    expect(Math.abs(starsCentre - lastLineCentre)).toBeLessThanOrEqual(2);
    // And the ring clears the stars by at least Amit's 8.
    expect(leftHeight - ratingBlock - ring).toBeGreaterThanOrEqual(TOKENS.space.xs);

    // The component's own formula, as text: last-line-derived, with the floor.
    const src = read(ROW);
    expect(src).toContain(
      'const ROW_LAST_LINE_CENTRE = PROVIDER_ROW_RIGHT_COLUMN - ROW_CATEGORY_LINE / 2',
    );
    expect(src).toContain('const ROW_CATEGORY_LINE = Math.round(TOKENS.icon.sm * ICON_SCALE)');
    const leftFormula = between(src, 'const PROVIDER_ROW_LEFT_COLUMN = Math.max(', ');\n');
    expect(leftFormula).toContain('ROW_LAST_LINE_CENTRE');
    expect(leftFormula).toContain('RING_TO_STARS');
    // The count sits one line gap under the stars, the same gap as the text
    // column's.
    expect(style('reviews')).toContain('marginTop: ROW_LINE_GAP');
  });

  it('rings the avatar in the accent, on every card without exception', () => {
    /*
     * Amit: "token color of ring around dp always". Astrotalk's is their brand
     * yellow at 76.4dp around a 72dp photo; ours is 2dp of accent with a 2dp
     * inset around 76, giving 84 against their 85.1dp holder.
     *
     * UNCONDITIONAL is the load-bearing word, not the colour. A ring that
     * appeared for some providers and not others — "available now", "top rated"
     * — would be the directory ranking strangers by decoration, which is the
     * thing theme.test.ts's monochrome rule exists to prevent. Asserted by
     * checking the style carries no conditional and the JSX applies it plainly.
     */
    const ring = style('ring');
    expect(ring).toContain('borderColor: t.color.bg.accent');
    expect(ring).toContain('borderWidth: RING_STROKE');
    expect(ring).toContain('padding: RING_INSET');
    expect(ring).toContain('width: ROW_AVATAR_RING');
    // The box maths, so a change to either constant cannot silently clip the
    // photo: RN draws borders inside the box.
    expect(read(ROW)).toContain('ROW_AVATAR + 2 * (RING_STROKE + RING_INSET)');
    expect(code(ROW)).toContain('style={styles.ring}');
    expect(code(ROW)).not.toMatch(/styles\.ring[^\n]*\?/);
  });

  it('marks every provider certified, because the view already guarantees it', () => {
    /*
     * Clarity's badge, and it is on every card rather than some — correctly:
     * `provider_directory` filters on `identity_verified_at is not null`, so a
     * provider a member can see has passed the PAN and identity check by
     * construction. A badge that is always true is a statement about the
     * marketplace, not a ranking within it, which is also why it can hold
     * accent without breaking the monochrome rule.
     */
    expect(code(ROW)).toContain('testID="provider-verified"');
    /*
     * ONE GLYPH, not our own check inside an accent disc — which is what it was
     * first built as, stacking two shapes to approximate a shape the icon set
     * already had. `seal-check` is Phosphor's scalloped rosette, the mark both
     * Clarity and Astrotalk draw, added through design/icons.json and
     * regenerated rather than hand-edited (RULE 4).
     */
    expect(code(ROW)).toContain("name=\"badgeCheck\"");
    expect(code(ROW)).not.toContain('styles.verified');
    // FILLED since 2026-09-26 (Amit: "phosphor seal check in blue colour,
    // filled"), as a `-fill` glyph name rather than an `active` entry, because
    // the seal has no unselected state.
    expect(read('design/icons.json')).toContain('"badgeCheck": "seal-check-fill"');
    expect(read('src/theme/icons.generated.ts')).toContain('badgeCheck:');
    // The CTA's green since 2026-09-27 (Amit: "change seal icon fill to same
    // cta green"), not Bluesky's blue and not the coral.
    expect(code(ROW)).toContain('color={theme.color.text.available}');
    // Out of the accessibility tree: the card's label would otherwise gain a
    // stop that says nothing a member can act on.
    expect(code(ROW)).toMatch(/testID="provider-verified"[\s\S]{0,120}badgeCheck/);
    expect(code(ROW)).toMatch(/accessible=\{false\} testID="provider-verified"/);
    // And the guarantee it rests on is real, checked against the migration
    // rather than trusted from the comment.
    expect(read('supabase/migrations/083_provider_expertise.sql')).toContain(
      'p.identity_verified_at is not null',
    );
  });

  it('draws the seal exactly as tall as the name\'s capitals, measured from both fonts', () => {
    /*
     * Amit, 2026-09-26: "with height equal to the first capital letter of the
     * name". Both halves of that are read out of the .ttf files here, not out
     * of the comment in ProviderRow.tsx, so a regenerated icon font (a new
     * Phosphor pin, a changed EM_WINDOW) or a different name face fails this
     * rather than leaving the component's arithmetic describing a glyph that
     * has moved.
     */
    // The name is alf text_xl SemiBold since 2026-09-27 (was Geist-Bold 16).
    const geist = readFileSync(join(ROOT, 'assets/fonts/Geist-SemiBold.ttf'));
    expect(TOKENS.typography.textXlSemiBold.fontFamily).toBe('Geist-SemiBold');
    expect(TOKENS.typography.textXlSemiBold.fontSize).toBe(18.8);
    expect(style('name')).toContain('...TOKENS.typography.textXlSemiBold');
    const capEm = capHeight(geist) / unitsPerEm(geist);
    expect(capEm).toBeCloseTo(0.71, 5);

    const phosphor = readFileSync(join(ROOT, 'assets/fonts/Phosphor.ttf'));
    const glyph = cmapOf(phosphor)(ICON_GLYPH.badgeCheck.codePointAt(0) ?? 0);
    expect(glyph).toBeGreaterThan(0);
    const box = glyphBounds(phosphor, glyph);
    const em = unitsPerEm(phosphor);
    const inkBottom = box.yMin / em;
    const inkTop = box.yMax / em;
    expect(inkBottom).toBeCloseTo(0.052, 5);
    expect(inkTop).toBeCloseTo(0.948, 5);

    // The component's constants are the fonts' numbers, term for term.
    const src = read(ROW);
    expect(src).toContain('const GEIST_CAP_HEIGHT = 0.71;');
    expect(src).toContain('const SEAL_INK_BOTTOM = 0.052;');
    expect(src).toContain('const SEAL_INK_TOP = 0.948;');
    expect(src).toContain(
      'const NAME_CAP_HEIGHT = GEIST_CAP_HEIGHT * TOKENS.typography.textXlSemiBold.fontSize',
    );
    expect(src).toContain(
      'const VERIFIED_SEAL_PX = Math.round(NAME_CAP_HEIGHT / (SEAL_INK_TOP - SEAL_INK_BOTTOM))',
    );
    expect(src).toContain('const VERIFIED_SEAL_SIZE = VERIFIED_SEAL_PX / ICON_SCALE');
    expect(code(ROW)).toContain('size={VERIFIED_SEAL_SIZE}');

    // The arithmetic: a 13.35dp cap height wants a 14.90dp box, `Icon` rounds
    // to 15, and 15 draws the seal 13.44dp tall, within a pixel of the caps and
    // on the overshoot side a round mark beside flat capitals should be.
    const cap = capEm * TOKENS.typography.textXlSemiBold.fontSize;
    expect(cap).toBeCloseTo(13.35, 2);
    const px = Math.round(cap / (inkTop - inkBottom));
    expect(px).toBe(15);
    // What Icon.tsx renders for the size the row passes it.
    expect(Math.round((px / 1.2) * 1.2)).toBe(15);
    const drawn = px * (inkTop - inkBottom);
    expect(drawn).toBeGreaterThanOrEqual(cap);
    expect(drawn - cap).toBeLessThan(0.5);

    // Seated on the baseline, not centred on the 24dp line box: the line
    // aligns on baselines, and the seal's ink is shifted down by the glyph's
    // own bottom bearing so the INK, not the box, sits on it.
    expect(style('nameLine')).toContain("alignItems: 'baseline'");
    expect(style('nameLine')).not.toContain("alignItems: 'center'");
    expect(src).toContain('const SEAL_BASELINE_SHIFT = SEAL_INK_BOTTOM * VERIFIED_SEAL_PX');
    expect(style('seal')).toContain('translateY: SEAL_BASELINE_SHIFT');
  });

  it('writes the gender as a letter before the age, and omits it when unknown', () => {
    // Astrotalk's shorthand: F-24, M-30. 'other' and null both fall through to
    // a bare age — a letter for "other" would either out somebody or invent a
    // category, and neither is a directory row's business.
    expect(genderLetter('female')).toBe('F');
    expect(genderLetter('male')).toBe('M');
    expect(genderLetter('other')).toBeNull();
    expect(genderLetter(null)).toBeNull();
    expect(code(ROW)).toContain("letter === null ? '' : `${letter}-`");
  });

  it('is a card, and does not keep half of the row it replaced', () => {
    /*
     * The separator and its inset are gone with the hairline idiom. Asserted as
     * an ABSENCE because the half-and-half state is the bad one: a card that
     * also draws a divider reads as a row wearing rounded corners, which is the
     * exact defect ThreadBubble's own gate was written against.
     */
    const body = code(ROW);
    expect(body).not.toContain('ROW_SEPARATOR_INSET');
    expect(body).not.toContain('styles.separator');
    /*
     * `hairlineWidth` may still appear — the card's own outline uses it — but
     * ONLY as a border width. A bare `not.toContain` was wrong and failed here:
     * it would have forced the card to draw a heavier 1dp edge than the page
     * needs in order to satisfy a rule that is about separators.
     */
    for (const line of body.split('\n').filter(l => l.includes('hairlineWidth'))) {
      expect(line).toMatch(/borderWidth: StyleSheet\.hairlineWidth/);
    }
    const card = style('card');
    expect(card).toContain('backgroundColor: t.color.bg.raised');
    expect(card).toContain('borderRadius: TOKENS.radius.sm');
    expect(card).toContain('marginBottom: ROW_CARD_GAP');
    // No elevation: a drop shadow on a recycled FlashList cell costs an
    // overdraw pass per frame, and the reference separates by fill.
    expect(card).not.toContain('elevation');
    expect(card).not.toContain('shadow');
  });

  it('renders one count line at every rating count, including zero', () => {
    /*
     * A provider with no reviews must occupy the same 16dp as one with a
     * thousand, or the left column measures differently per row and
     * PROVIDER_ROW_HEIGHT is a promise the row does not keep.
     *
     * There is now no branch at all, which is the stronger form: the count is
     * unconditional and only the plural changes. The first device build had a
     * branch, and its zero case read "no ratings yet" — fourteen characters in
     * a 76dp column, so the Redmi rendered "no ratings …". An ellipsis on a
     * fixed-width label is the label being wrong, not the width.
     */
    const jsx = code(ROW);
    expect(jsx).not.toContain('no ratings');
    expect(jsx).toContain('formatReviewCount(rating.count)');
    // No branch at all: `displayRating` always returns a count, so there is no
    // zero case left in the view to render differently or get wrong.
    expect(jsx).not.toMatch(/rating_count > 0/);
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

  it('has three press targets now, and the third one earned it', () => {
    /*
     * REVERSED from "exactly two", deliberately, and the reasoning is the same
     * as the reasoning that produced the old number.
     *
     * The chevron was refused a target because it performed the CARD's action —
     * a duplicate, and a second TalkBack stop for nothing. The CTA said "Chat"
     * and was refused for the same reason. It now says "Call" (Amit: "our CTA
     * will be call not chat"), which is a DIFFERENT action from opening the
     * conversation, so it needs its own target and its own label.
     *
     * Three, and no more: card, avatar, CTA. Each does something the others do
     * not.
     */
    const body = code(ROW);
    expect(body.match(/<Pressable/g)?.length).toBe(3);
    /*
     * The CTA carries its own spoken label, or TalkBack reads the card's — and
     * since 2026-09-13 the away state has its own, because "Call <name>" would
     * be a lie on a row whose button no longer calls.
     */
    expect(body).toMatch(/`Notify \$\{firstName\} that you want to chat`/);
    expect(body).toMatch(/`Call \$\{firstName\}`/);
  });

  it('keeps the tag pills out of the accessibility tree', () => {
    // MetaChip is `accessible={false}`; the row's own label carries the tags in
    // words, so a TalkBack user gets them in one utterance rather than as three
    // unlabelled stops.
    expect(code('src/components/MetaChip.tsx')).toContain('accessible={false}');
    // The spoken label carries whichever the line is showing — the tags when
    // there are tags, the headline when there are not — so a TalkBack user
    // hears the same fact a sighted one reads, in one utterance.
    expect(code(ROW)).toMatch(/tags\.length > 0 \? tags\.join\(', '\) : headline/);
  });
});

describe('the CTA is a 33dp small button inside a 48dp target', () => {
  it('draws Bluesky\'s small button but keeps the 48dp target', () => {
    /*
     * Amit, 2026-09-26: "smaller, from our system's small button". Bluesky's
     * small button is 12dp across and 8dp down around semibold text_sm (13.1 on
     * a 17 line): 8 + 17 + 8 = 33, down from Astrotalk's 36. The 48dp touch
     * minimum still applies with full force, and is kept two ways: the price
     * ROW stays ROW_CTA_HEIGHT (48) with the button centred in it, and the
     * Pressable's `size={ROW_CTA_VISUAL_HEIGHT}` turns the 15dp difference into
     * hitSlop without inflating the drawing.
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     */
    const src = read(ROW);
    expect(src).toContain('const ROW_CTA_HEIGHT = TOKENS.interaction.minTarget');
    // A fixed 108 × 36 since 2026-09-27: hugging its content with only a
    // minHeight, the button stretched to its 48dp slot and DREW 74 × 48 on
    // the S22. 36 is its old height and Astrotalk's (35.6).
    expect(src).toContain('export const ROW_CTA_VISUAL_HEIGHT = 36;');
    expect(src).toContain('const ROW_CTA_WIDTH = 108;');
    const visual = 36;
    expect(code(ROW)).toContain('size={ROW_CTA_VISUAL_HEIGHT}');
    expect(TOKENS.interaction.minTarget).toBe(48);
    // Pressable's own slop formula, for the size the row passes: 8 each side.
    const slop = Math.max(8, Math.ceil((TOKENS.interaction.minTarget - visual) / 2));
    expect(slop).toBe(8);
    expect(visual + 2 * slop).toBeGreaterThanOrEqual(TOKENS.interaction.minTarget);
    expect(read('src/components/Pressable.tsx')).toContain(
      'Math.max(8, Math.ceil((INTERACTION.minTarget - size) / 2))',
    );

    /*
     * The stroke is drawn OVER the padding by its own absolute layer, not by a
     * border that takes layout: 8 + 17 + 8 = 33, and the 1dp outline covers
     * the outermost dp of each 8, so the glyph still sits 7dp inside the ink,
     * the same pixels the old in-box border (1 + 7 + 17 + 7 + 1) drew.
     */
    expect(src).toContain('const CTA_STROKE = 1;');
    expect(src).toContain('const CTA_PAD_Y = TOKENS.space.xs;');
    expect(src).toContain('const CTA_PAD_X = TOKENS.space.sm;');
    // The padded content (8 + 17 + 8 = 33) fits inside the fixed 36 drawing,
    // which centres it; the height is the button's own, not the content's.
    expect(TOKENS.space.xs * 2 + TOKENS.typography.textSmSemiBold.lineHeight).toBeLessThanOrEqual(visual);

    /*
     * The glyph's box is the label's line box, so it cannot be the tallest thing
     * in the button: 17 / ICON_SCALE, which Icon rounds back to 17.
     * `icon.sm` renders 19 and would set the button to 35.
     */
    expect(src).toContain(
      'const CTA_ICON_SIZE = TOKENS.typography.textSmSemiBold.lineHeight / ICON_SCALE',
    );
    const lh = TOKENS.typography.textSmSemiBold.lineHeight;
    expect(Math.round((lh / 1.2) * 1.2)).toBe(lh);
    expect(Math.round(TOKENS.icon.sm * 1.2)).toBeGreaterThan(lh);

    const cta = style('cta');
    // A DEFINITE 108 × 36 (2026-09-27): with only a minHeight the button was
    // stretched by its 48dp slot and drew 74 × 48 on the S22. One shape for
    // Call, Notify and Notified, like Astrotalk's call_rl.
    expect(cta).toContain('height: ROW_CTA_VISUAL_HEIGHT,');
    expect(cta).toContain('width: ROW_CTA_WIDTH,');
    expect(cta).not.toMatch(/minHeight/);
    expect(cta).toContain('paddingHorizontal: CTA_PAD_X');
    expect(cta).toContain('paddingVertical: CTA_PAD_Y');
    // The outline is a layer, so nothing on the button itself draws an edge
    // that the press could not take away.
    expect(cta).not.toContain('borderWidth');
    expect(cta).not.toContain('borderColor');
    const outline = style('ctaOutline');
    expect(outline).toContain("position: 'absolute'");
    expect(outline).toContain('borderWidth: CTA_STROKE');
    expect(outline).toContain('borderRadius: TOKENS.radius.xs');
    // The outline carries no colour of its own: the state gives it one.
    expect(outline).not.toContain('borderColor');
    expect(style('ctaOutlineFree')).toContain('borderColor: t.color.text.available');
    expect(style('ctaOutlineBusy')).toContain('borderColor: t.color.state.danger');
    expect(style('ctaOutlineAway')).toContain('borderColor: t.color.text.secondary');
    expect(style('ctaAway')).not.toContain('borderColor');
    // ROW_CTA_WIDTH is back (108, 2026-09-27): one fixed shape for every state.
    expect(src).toContain('const ROW_CTA_WIDTH = 108;');
    expect(style('ctaLabel')).toContain('...TOKENS.typography.textSmSemiBold');
  });

  it('fills solid under the finger, on opacity, on the UI thread', () => {
    /*
     * Amit, 2026-09-26: the CTA "fills up on click", solid while pressed.
     * animate-expo's gate: tens of presses a day, so near-imperceptible timing
     * (100-150ms) on its strong ease-out, feedback on press-in, and nothing
     * stacked on top: no scale, no state layer.
     */
    const body = code(ROW);
    const cta = between(body, 'testID={`provider-cta-${provider.id}`}', '</Pressable>');
    const pressable = between(body, 'onPress={() =>\n                    away', 'style={[styles.cta');
    expect(pressable).toContain('press="none"');
    expect(pressable).toContain('highlight="none"');
    expect(pressable).toContain('onPressIn={() => fill.set(withTiming(1, CTA_FILL_IN))}');
    expect(pressable).toContain('onPressOut={() => fill.set(withTiming(0, CTA_FILL_OUT))}');
    expect(cta).toContain('<Animated.View');
    expect(cta).toContain('style={[styles.ctaFill, ctaTone.fill, fillStyle]}');
    // One property, and the free one.
    expect(body).toContain('const fillStyle = useAnimatedStyle(() => ({ opacity: fill.get() }))');
    expect(body).not.toMatch(/interpolateColor|withSpring/);
    // The curve and the budget are the tokens, not hand-typed numbers, and
    // reduced motion snaps rather than tweens.
    const fillIn = between(read(ROW), 'const CTA_FILL_IN = {', '} as const;');
    expect(fillIn).toContain('duration: DURATION.pressRamp');
    expect(fillIn).toContain('easing: EASE_OUT_QUINT');
    expect(fillIn).toContain('reduceMotion: ReduceMotion.System');
    const fillOut = between(read(ROW), 'const CTA_FILL_OUT = {', '} as const;');
    expect(fillOut).toContain('duration: DURATION.pressRamp * 1.5');
    expect(fillOut).toContain('easing: EASE_OUT_QUINT');
    expect(fillOut).toContain('reduceMotion: ReduceMotion.System');
    expect(TOKENS.motion.duration.pressRamp).toBe(100);
    expect(TOKENS.motion.duration.pressRamp * 1.5).toBeLessThanOrEqual(150);

    // The pressed face is out of flow and out of the accessibility tree.
    const fill = style('ctaFill');
    expect(fill).toContain("position: 'absolute'");
    expect(fill).not.toContain('backgroundColor');
    const outline = style('ctaOutline');

    /*
     * NO RIM WHILE PRESSED (Amit, on the S22, 2026-09-27). This used to pin the
     * opposite: the fill on the outline's INNER radius, inside a 1dp stroke
     * that stayed drawn, which in dark was a peach step-300 rim round the solid
     * coral. Now the fill runs edge to edge on the button's own radius and the
     * outline fades out on the same shared value, so fully pressed there is
     * one solid shape and nothing lighter round it, in every state's colour.
     */
    for (const edge of ['top: 0', 'right: 0', 'bottom: 0', 'left: 0']) {
      expect(fill).toContain(edge);
      expect(outline).toContain(edge);
    }
    expect(fill).toContain('borderRadius: TOKENS.radius.xs,');
    expect(fill).not.toContain('CTA_STROKE');
    expect(style('cta')).toContain('borderRadius: TOKENS.radius.xs,');
    expect(body).toContain(
      'const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.get() }))',
    );
    // The outline layer paints FIRST (under the glyph and word), the fill last.
    const layers = between(body, 'style={[styles.cta, away && styles.ctaAway]}>', '</Pressable>');
    const outlineAt = layers.indexOf('styles.ctaOutline, ctaTone.outline, outlineStyle');
    expect(outlineAt).toBeGreaterThan(-1);
    expect(outlineAt).toBeLessThan(layers.indexOf('<Icon'));
    expect(layers.indexOf('styles.ctaFill')).toBeGreaterThan(layers.indexOf('<Icon'));
    /*
     * The coral press cost 2.91:1 against the dark card and carried a named
     * exemption. The state colours need none: each fill is its own edge past
     * 3:1 and each label on it past 4.5:1, in both modes, registered as plain
     * pairs. The exemption is gone with the coral.
     */
    const contrast = read('scripts/check-contrast.mjs');
    expect(contrast).not.toMatch(/fg: 'bg\/accent',\s+bg: 'bg\/raised'/);
    expect(contrast).toMatch(/fg: 'bg\/available',\s+bg: 'bg\/raised',\s+target: 3,/);
    expect(contrast).toMatch(/fg: 'text\/onState',\s+bg: 'bg\/available',\s+target: 4\.5,/);
    expect(contrast).toMatch(/fg: 'text\/onState',\s+bg: 'state\/danger',\s+target: 4\.5,/);
    expect(style('ctaFillFree')).toContain('backgroundColor: t.color.bg.available');
    expect(style('ctaFillBusy')).toContain('backgroundColor: t.color.state.danger');
    expect(style('ctaFillLabel')).toContain('color: t.color.text.onState');
    expect(cta).toContain('pointerEvents="none"');
    expect(cta).toContain('importantForAccessibility="no-hide-descendants"');
    // The away variant fills in its own neutral, never the coral.
    expect(style('ctaFillAway')).toContain('backgroundColor: t.color.bg.inverse');
    expect(style('ctaFillAwayLabel')).toContain('color: t.color.text.onInverse');
    // Pressable's `none` highlight really draws nothing of its own.
    const pressableSrc = code('src/components/Pressable.tsx');
    expect(pressableSrc).toContain("type Highlight = 'material' | 'dim' | 'ripple' | 'none'");
    expect(pressableSrc).toContain('ripple || bare ? 0 : INTERACTION.statePressed');
    expect(pressableSrc).toContain('onPressOutProp?.()');
  });

  it('puts the rate on the name line, in the F-29 register, and never struck through today', () => {
    /*
     * Amit, 2026-09-26: the rate leaves the CTA for the NAME line, right
     * aligned, the same size and style as the "F-29" subscript. It takes
     * `nameAge` whole and overrides one property, the ink: text/tertiary is
     * 3.30:1 on the dark card, and a price is not glanceable metadata.
     */
    const body = code(ROW);
    const nameLine = between(body, '<View style={styles.nameLine}>', 'provider-tags-');
    expect(nameLine).toContain('<RateLabel');
    expect(nameLine).toContain('rate={ratePerMin}');
    expect(nameLine).toContain('style={[styles.nameAge, styles.rate]}');
    const rate = style('rate');
    expect(rate).toContain('color: t.color.text.secondary');
    expect(rate).toContain("marginLeft: 'auto'");
    expect(rate).toContain('flexShrink: 0');
    // The NAME is what gives way, so a long one ellipsizes before the rate.
    expect(style('name')).toContain('flexShrink: 1');
    expect(nameLine).toMatch(/numberOfLines=\{1\}\s+style=\{styles\.name\}/);

    /*
     * The struck anchor has a SLOT (RateLabel's `original`) and no caller. We
     * have one undiscounted rate; an anchor price with no discount behind it
     * would be invented, the same class of claim as the false per-message cost
     * removed in 75ced47. The day a discount source exists, this is the line
     * that changes.
     */
    expect(body).not.toMatch(/original=\{/);
    expect(body.match(/textDecorationLine/g)?.length).toBe(1);
    expect(style('rateOriginal')).toContain("textDecorationLine: 'line-through'");
    expect(style('rateOriginal')).toContain('color: t.color.text.tertiary');
    /*
     * One rate, through `RupeeAmount` on the card and `formatRupees` in the
     * spoken label, so the ₹ keeps its lighter weight without changing what
     * TalkBack hears.
     */
    expect(body).toContain('<RupeeAmount value={rate} />');
    expect(body).toContain('formatRupees(ratePerMin)'); // the spoken label
    expect(body.match(/formatRupees\(/g)?.length).toBe(1);
    // And it is gone from the button and from the tail beside it.
    const tail = between(body, '<View style={styles.tail}>', '</Pressable>');
    expect(tail).not.toContain('RupeeAmount');
    expect(tail).not.toContain('ratePerMin');
    expect(body).not.toContain('ctaRate');
  });

  it('does not offer a Call button to a provider who has switched calls off', () => {
    /*
     * `audio_enabled` is migration 064's provider-owned switch. A Call button
     * on somebody who does not take calls fails at `start_call` AFTER the tap —
     * the false-affordance class this codebase has now removed twice, in the
     * composer's "costs one token" hints and in this row's own phone glyph.
     *
     * Both the label and the action follow the capability, and they follow the
     * SAME flag, so they cannot disagree.
     *
     * AWAY joined the flag on 2026-09-13, and it belongs to the same rule
     * rather than sitting beside it: a provider who is not there cannot take a
     * call either, so offering one is the identical false affordance. The label
     * gains a third state — "Notify", with a bell — and the action still falls
     * through to opening the conversation, which is what actually notifies
     * them (announce_chat_open, migration 068).
     */
    const body = code(ROW);
    expect(body).toContain(
      'const canCall = provider.audio_enabled && onCall !== undefined && !away',
    );
    // The switch, not the dot (migration 155): open but idle for more than
    // 75 s is not online and is still callable, so the heartbeat must not put
    // a Notify on somebody who would pick up.
    expect(body).toContain('const away = !provider.is_available;');
    expect(body).not.toContain('const away = !presence.here');
    /*
     * The fallback stopped being the literal 'Chat' on 2026-09-17. It was the
     * same false affordance one layer down: a provider who offers video only
     * still got a button saying Chat, which fails after the tap for exactly the
     * reason the phone glyph and the Call button already had to go. It now
     * falls through the offered set in the order the member's own buttons sit,
     * so the word names something the provider actually takes.
     */
    expect(body).toContain(
      "const ctaLabel = providerCtaLabel({\n    isAvailable: provider.is_available,\n    audioEnabled: provider.audio_enabled,\n    chatEnabled: provider.chat_enabled,\n    canDial: onCall !== undefined,\n  });",
    );
    expect(body).toMatch(/canCall && onCall !== undefined \? onCall\(provider\.id\) : onPress\(provider\.id\)/);
  });

  it('leads every CTA state with its glyph', () => {
    /*
     * REVERSED 2026-09-26 (Amit's approved mockup). The old rule, from "remove
     * call icon before 22/min", banned a phone in front of a PRICE, where it
     * only restated what the price bought. The price has left the button, and a
     * glyph before a one-word verb is the small-button idiom: phone for Call,
     * camera for Video, bubble for Chat, bell for Notify, check once notified.
     */
    const body = code(ROW);
    expect(body).toContain(
      "const CTA_VERB_ICON = {\n  Call: 'call',\n  Chat: 'chat',\n  Video: 'video',\n  Notify: 'bell',\n}",
    );
    expect(body).toContain(
      "const ctaIcon: IconName = notified ? 'check' : CTA_VERB_ICON[ctaLabel]",
    );
    const tail = between(body, '<View style={styles.tail}>', '</Pressable>');
    const icons = tail.match(/<Icon\s+name=(?:"\w+"|\{[^}]+\})/g) ?? [];
    expect(icons.map(i => i.replace(/\s+/g, ' '))).toEqual([
      '<Icon name={categoryKey}', // the category mark
      '<Icon name={ctaIcon}', // the resting face
      '<Icon name={ctaIcon}', // the pressed face, the same glyph
    ]);
    expect(body).toContain('size={CTA_ICON_SIZE}');
  });

  it('draws the category as coloured text behind a filled glyph, not a chip', () => {
    /*
     * Amit, 2026-09-26: "like trophy + Wellness Guide". The glyph names are the
     * category keys, which design/icons.json maps to FILLED Phosphor glyphs
     * (flower-fill, moon-stars-fill); the ink is each category's text-safe
     * tone on the card, registered in scripts/check-contrast.mjs.
     */
    const body = code(ROW);
    expect(body).not.toContain('<MetaChip');
    expect(read('design/icons.json')).toContain('"listener": "flower-fill"');
    expect(read('design/icons.json')).toContain('"astrologer": "moon-stars-fill"');
    const category = between(body, 'testID="provider-category"', '<View style={styles.ctaSlot}>');
    expect(category).toContain('name={categoryKey}');
    expect(category).toContain('size={TOKENS.icon.sm}');
    expect(category).toContain('{category}');
    expect(style('categoryLabel')).toContain('...TOKENS.typography.textSmSemiBold');
    expect(style('categoryListener')).toContain('color: t.color.text.listener');
    expect(style('categoryAstrologer')).toContain('color: t.color.text.astrologer');
    const contrast = read('scripts/check-contrast.mjs');
    expect(contrast).toMatch(/fg: 'text\/listener',\s+bg: 'bg\/raised',\s+target: 4\.5/);
    expect(contrast).toMatch(/fg: 'text\/astrologer',\s+bg: 'bg\/raised',\s+target: 4\.5/);
    expect(contrast).toMatch(/fg: 'mark\/verified',\s+bg: 'bg\/raised',\s+target: 3/);
  });
});

describe('every row is still the same height', () => {
  it('keeps the specialities to one plain text line', () => {
    /*
     * Three tags at most, and one line always. `ROW_EXPERTISE_LIMIT` caps the
     * array; `numberOfLines={1}` holds the line, so a longer set ellipsizes
     * rather than wrapping and pushing the CTA row down.
     *
     * It used to be a 24dp slot with `overflow: 'hidden'`, sized for chips
     * (MetaChip's small height), and that is gone on purpose (Amit, on the S22,
     * 2026-09-27): the specialities have been plain comma text since the chips
     * went, and a 16dp line in a 24dp slot put 4dp of dead space either side of
     * it, which is why the gap after it read biggest on the card.
     */
    /*
     * The cap now lives entirely in `rowExpertise`, where the row used to
     * re-apply it after prepending the category badge. The badge moved to its
     * own line under Exp, so there is nothing to prepend and nothing to
     * re-slice — and the topics got back the slot the badge was taking in
     * search.
     */
    expect(code('src/lib/expertise.ts')).toContain('export const ROW_EXPERTISE_LIMIT = 3');
    expect(code(ROW)).toContain('const tags = rowExpertise(provider)');
    expect(code(ROW)).not.toContain('.slice(0, ROW_EXPERTISE_LIMIT)');
    const body = code(ROW);
    const tags = between(body, 'testID={`provider-tags-${provider.id}`}', '</Text>');
    expect(body).toMatch(/numberOfLines=\{1\}\s+testID=\{`provider-tags-/);
    expect(tags).toContain('styles.channelLine : styles.secondary');
    // No slot left over from the chips.
    expect(body).not.toContain('META_CHIP_HEIGHT_SM');
    expect(body).not.toContain('ROW_TAG_LINE');
    expect(body).not.toContain('styles.tagLine');
    expect(style('secondary')).toContain('...TOKENS.typography.bodySmall');
    expect(style('channelLine')).toContain('...TOKENS.typography.bodySmall');
  });

  it('spaces every text line by the same one gap', () => {
    /*
     * Amit, on the S22 (2026-09-27): the gaps between the card's lines were
     * uneven, and the one after the specialities looked biggest. Measured line
     * box to line box (includeFontPadding is false throughout), they were
     * 6 · 6 · 2 · 9.5 down the right column and 8 · 2 down the left. They are
     * now all ROW_LINE_GAP, `space['2xs']` (4), and the ring-to-stars gap is
     * Amit's 8 (asserted above). The lead measured Astrotalk's card on the S22
     * the same way: 17.1dp detail lines on a 21dp pitch, a uniform ~4.
     */
    const src = read(ROW);
    expect(src).toContain("const ROW_LINE_GAP = TOKENS.space['2xs']");
    expect(TOKENS.space['2xs']).toBe(4);
    expect(style('label')).toContain('gap: ROW_LINE_GAP');
    expect(style('label')).not.toContain('hair');
    // Exp and the category are two lines of the same column rhythm.
    expect(style('tailLines')).toContain('gap: ROW_LINE_GAP');
    expect(code(ROW)).not.toContain('styles.priceLine');
    expect(code(ROW)).not.toContain('priceSpacer');
  });

  it('centres the CTA across the last two lines without growing the column', () => {
    /*
     * Amit, 2026-09-27, Astrotalk's placement: the CTA sits at the right,
     * centred across "Exp" and the category line, instead of owning a 48dp row
     * under them. Its slot is a real 48dp box (so hitSlop lands inside a
     * parent) that lays out at the button's drawn 33 via a negative margin on
     * the plain wrapper View, never on the Pressable (see HomeScreen's
     * seeAllBleed), and 33 is less than the two lines' 39, so the button never
     * sets the tail's height.
     */
    const src = read(ROW);
    const body = code(ROW);
    expect(src).toContain('const ROW_CTA_BLEED = (ROW_CTA_HEIGHT - ROW_CTA_VISUAL_HEIGHT) / 2');
    expect(src).toContain(
      'const ROW_TAIL =\n  TOKENS.typography.bodySmall.lineHeight + ROW_LINE_GAP + ROW_CATEGORY_LINE',
    );
    const slot = style('ctaSlot');
    expect(slot).toContain('height: ROW_CTA_HEIGHT');
    expect(slot).toContain('marginVertical: -ROW_CTA_BLEED');
    expect(slot).toContain("justifyContent: 'center'");
    expect(style('tail')).toContain("flexDirection: 'row'");
    expect(style('tail')).toContain("alignItems: 'center'");
    expect(style('cta')).not.toMatch(/margin/);
    // Structure: the tail holds the two lines, then the slot with the CTA.
    const tail = between(body, '<View style={styles.tail}>', '<View style={styles.ctaSlot}>');
    expect(tail).toContain('<View style={styles.tailLines}>');
    expect(tail).toContain('Exp · ');
    expect(tail).toContain('testID="provider-category"');
    expect(between(body, '<View style={styles.ctaSlot}>', '</Pressable>')).toContain(
      'testID={`provider-cta-${provider.id}`}',
    );

    const drawn = TOKENS.space.xs * 2 + TOKENS.typography.textSmSemiBold.lineHeight;
    const bleed = (TOKENS.interaction.minTarget - drawn) / 2;
    const tailHeight =
      TOKENS.typography.bodySmall.lineHeight + TOKENS.space['2xs'] + Math.round(TOKENS.icon.sm * 1.2);
    expect(bleed).toBe(7.5);
    expect(tailHeight).toBe(39);
    // What the slot costs the row, and that it is less than the lines.
    expect(TOKENS.interaction.minTarget - 2 * bleed).toBe(drawn);
    expect(drawn).toBeLessThan(tailHeight);
  });

  it('colours the CTA by state: green free, garnet busy, neutral away, never coral', () => {
    /*
     * Amit, 2026-09-27. One lookup (`ctaTone`) feeds the outline, the resting
     * ink and both pressed layers, so they cannot disagree about the state.
     * Away outranks busy: a provider who is not here cannot be waited out.
     */
    const body = code(ROW);
    expect(body).toContain('const busy = away ? null : readBusy(provider)');
    const tone = between(body, 'const ctaTone = away', ';\n');
    expect(tone.indexOf('styles.ctaOutlineAway')).toBeLessThan(tone.indexOf('busy !== null'));
    expect(tone).toContain('outline: styles.ctaOutlineBusy');
    expect(tone).toContain('label: styles.ctaBusyLabel');
    expect(tone).toContain('fill: styles.ctaFillBusy');
    expect(tone).toContain('outline: styles.ctaOutlineFree');
    expect(tone).toContain('label: styles.ctaFreeLabel');
    expect(tone).toContain('fill: styles.ctaFillFree');
    expect(style('ctaFreeLabel')).toContain('color: t.color.text.available');
    expect(style('ctaBusyLabel')).toContain('color: t.color.state.danger');
    expect(style('ctaAwayLabel')).toContain('color: t.color.text.primary');
    // The label's base style carries the type only; the state carries the ink.
    expect(style('ctaLabel')).not.toContain('color');
    // No coral anywhere on the CTA.
    const ctaStyles = between(rowStyles(), '  cta: {', '  ctaAway: {');
    expect(ctaStyles).not.toMatch(/accent/);
    const contrast = read('scripts/check-contrast.mjs');
    expect(contrast).toMatch(/fg: 'text\/available',\s+bg: 'bg\/raised',\s+target: 4\.5,/);
    expect(contrast).toMatch(/fg: 'text\/available',\s+bg: 'bg\/raised',\s+target: 3,/);
    expect(contrast).toMatch(/fg: 'state\/danger',\s+bg: 'bg\/raised',\s+target: 4\.5,/);
  });

  it('hangs the busy wait line under the button, inside the card', () => {
    /*
     * "wait ~12m" (or "Busy") in the button's garnet at textXs, directly under
     * the button, out of flow so it never grows the column. The line's bottom
     * is derived, and it has to land inside the card's content height, which
     * the left column's review count already makes the card give.
     */
    const body = code(ROW);
    const src = read(ROW);
    const slot = between(body, '<View style={styles.ctaSlot}>', '</View>\n          </View>');
    expect(slot).toContain('{busy !== null ? (');
    expect(slot).toContain('{busyLine(busy)}');
    expect(slot).toContain('testID={`provider-busy-${provider.id}`}');
    expect(slot).toContain('importantForAccessibility="no"');
    const line = style('busyLine');
    expect(line).toContain('...TOKENS.typography.textXs');
    expect(line).toContain('color: t.color.state.danger');
    expect(line).toContain("position: 'absolute'");
    expect(line).toContain('top: ROW_CTA_HEIGHT - ROW_CTA_BLEED + BUSY_LINE_GAP');
    expect(src).toContain('const BUSY_LINE_GAP = TOKENS.space.hair');
    // Spoken on the CTA and in the card's summary, since the drawn line is
    // hidden from TalkBack.
    expect(body).toContain('`${ctaSpoken}, ${busyForSpeech(busy)}`');
    expect(body).toContain('busy !== null ? busyForSpeech(busy) : null');

    const drawn = TOKENS.space.xs * 2 + TOKENS.typography.textSmSemiBold.lineHeight;
    const right = 107;
    const tail = 39;
    const bottom = right - tail / 2 + drawn / 2 + TOKENS.space.hair + TOKENS.typography.textXs.lineHeight;
    expect(TOKENS.typography.textXs.lineHeight).toBe(15);
    expect(bottom).toBe(121);
    expect(bottom).toBeLessThanOrEqual(126); // the left column, the card's content
  });

  it('computes to a 150dp card and a 162dp pitch, from the tokens', () => {
    /*
     * The card is TWO columns of different heights — the shape the reference
     * uses and the reason the avatar grew. Every term is a token, so a change
     * to the type scale fails here rather than silently mis-hinting the list.
     *
     *   right  name 24 · 4 · specialities 16 · 4 · langs 16 · 4 · exp 16 · 4 · category 19 = 107
     *   left   ring 84 · 8 · stars 14 · 4 · count 16                                     = 126
     *
     * The CTA is not a line: since 2026-09-27 it sits at the right of Exp and
     * the category, centred across them, the way Astrotalk's `call_rl`
     * straddles its lines.
     *
     * Was 160 of card (right column 136: 24 · 2 · 24 · 2 · 16 · 2 · 16 · 2 · 48)
     * and 172 of pitch, then 155.5 / 167.5 with uniform gaps and the CTA row at
     * its drawn 33. Now 150 and 162, against the reference's 146.2dp
     * `row_content_holder` and 180.4 pitch.
     *
     * THIS TEST USED TO PASS WHILE DESCRIBING THE WRONG ROW. It recomputed the
     * old four-line stack from tokens and asserted 142, and the arithmetic
     * still came to 142 after the component became a five-line card — because
     * it never read the component. The import below is the fix: the expected
     * value now comes from the same constants the row lays itself out with, so
     * the test cannot agree with itself while disagreeing with the screen.
     */
    // The star row's height, as RatingStars computes it, read from source for
    // the same reason as everything else here.
    /*
     * 2026-09-08: `STARS_HEIGHT` (and `STARS_WIDTH`) moved from a hand-spelled
     * `Math.round(STAR * 1.2)` to `Math.round(STAR * ICON_SCALE)` — see
     * RatingStars.tsx's `STAR_BOX` comment for the defect this fixed (the width
     * was NOT scaled while the height was, so the star row silently rendered
     * wider than the box everything else centred against, reading as shifted
     * right of the avatar above it). The value this test needs is unchanged
     * (14); only the source line it greps for is.
     */
    const starsHeight = Math.round(TOKENS.icon.xs * 1.2);
    expect(read('src/components/RatingStars.tsx')).toContain(
      'const STAR_BOX = Math.round(STAR * ICON_SCALE)',
    );
    expect(read('src/components/RatingStars.tsx')).toContain(
      'export const STARS_HEIGHT = STAR_BOX',
    );
    const ringSize = 76 + 2 * (2 + 2);

    const gap = TOKENS.space['2xs'];
    const categoryLine = Math.round(TOKENS.icon.sm * 1.2);
    const right =
      TOKENS.typography.textXlSemiBold.lineHeight +
      gap +
      TOKENS.typography.bodySmall.lineHeight +
      gap +
      TOKENS.typography.bodySmall.lineHeight +
      gap +
      TOKENS.typography.bodySmall.lineHeight +
      gap +
      categoryLine;
    const leftFloor =
      ringSize + TOKENS.space.xs + starsHeight + gap + TOKENS.typography.bodySmall.lineHeight;
    const left = Math.max(
      right - categoryLine / 2 + starsHeight / 2 + gap + TOKENS.typography.bodySmall.lineHeight,
      leftFloor,
    );
    /*
     * The LEFT column sizes the card, at its floor (the ring's 8dp): exact
     * alignment with the category line would want 124.5 and crowd the ring.
     */
    expect(categoryLine).toBe(19);
    expect(right).toBe(107);
    expect(leftFloor).toBe(126);
    expect(left).toBe(126);
    expect(left).toBeGreaterThan(right);
    const card = 2 * TOKENS.space.sm + Math.max(left, right);
    expect(card).toBe(150);
    expect(card + TOKENS.space.sm).toBe(162);

    /*
     * ...and the COMPONENT'S OWN FORMULA, term for term, which is the half the
     * previous version was missing. The numbers above are this test's
     * arithmetic; these are the row's. If the stack gains or loses a line, the
     * text below stops matching even when the total happens to survive.
     */
    const src = read(ROW);
    const leftFormula = between(src, 'const PROVIDER_ROW_LEFT_COLUMN = Math.max(', ');\n');
    expect(leftFormula).toContain('ROW_LAST_LINE_CENTRE');
    expect(leftFormula).toContain('ROW_AVATAR_RING');
    expect(leftFormula.match(/STARS_HEIGHT/g)?.length).toBe(2);
    expect(leftFormula).toContain('RING_TO_STARS');
    expect(read(ROW)).toContain('const RING_TO_STARS = TOKENS.space.xs');

    const rightFormula = between(src, 'const PROVIDER_ROW_RIGHT_COLUMN =', ';');
    expect(rightFormula).toContain('textXlSemiBold.lineHeight');
    // The CTA is in none of it: the tail is Exp and the category.
    expect(rightFormula).toContain('ROW_TAIL');
    expect(rightFormula).not.toContain('ROW_CTA');
    expect(rightFormula).not.toContain('ROW_TAG_LINE');
    // Two bodySmall lines here (specialities, languages) and the third, Exp,
    // inside ROW_TAIL. Fewer would mean a line got dropped while the total
    // still looked plausible.
    expect(rightFormula.match(/bodySmall\.lineHeight/g)?.length).toBe(2);
    const tailFormula = between(src, 'const ROW_TAIL =', ';');
    expect(tailFormula).toContain('bodySmall.lineHeight');
    expect(tailFormula).toContain('ROW_CATEGORY_LINE');
    // Four gaps between the five lines, all the same: three here, one in the
    // tail.
    expect(rightFormula.match(/ROW_LINE_GAP/g)?.length).toBe(3);
    expect(tailFormula.match(/ROW_LINE_GAP/g)?.length).toBe(1);
    expect(rightFormula).not.toContain('space.hair');

    expect(src).toContain(
      'PROVIDER_CARD_HEIGHT =\n  CARD_PAD * 2 + Math.max(PROVIDER_ROW_LEFT_COLUMN, PROVIDER_ROW_RIGHT_COLUMN)',
    );
    expect(src).toContain('PROVIDER_CARD_HEIGHT + ROW_CARD_GAP');
    // Derived, never written down.
    expect(src).not.toMatch(/PROVIDER_CARD_HEIGHT = \d/);
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
    // The import is multi-line now (HomeScreen also pulls
    // `seededExperienceYears` for the hero's meta line), so match the symbol
    // rather than a one-line import shape.
    expect(home).toMatch(/PROVIDER_ROW_HEIGHT,[\s\S]{0,120}from '\.\.\/components\/ProviderRow'/);
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
    /*
     * Three since 2026-09-27, still read once: the search row, the directory
     * row, and the hand-off into `DirectoryPage` (one per category page of the
     * Home pager), which passes its prop straight to its rows. The hook itself
     * is still called exactly once on the screen.
     */
    expect(home.match(/ratePerMin=\{ratePerMin\}/g)?.length).toBe(3);
    expect(home.match(/useEconomicsConfig\(\)/g)?.length).toBe(1);
  });

  it('leaves the card top-aligned, since the columns differ', () => {
    // `center` would float the 107dp text column down from the top of the
    // 126dp avatar column. Astrotalk top-aligns for the same reason.
    expect(style('card')).toContain("alignItems: 'flex-start'");
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
  });
});

describe('the tag line always has something in it', () => {
  /*
   * BOTH ASSERTIONS HERE COME FROM A DEVICE BUILD, not from review, and neither
   * would have failed anything before it. That is the whole of RULE 2 in one
   * suite: `npm run verify` was green, 1608 tests passed, and the row on the
   * Redmi was visibly wrong in two ways.
   */
  it('falls back to the headline, so an untagged provider is not a blank line', () => {
    /*
     * On the first Redmi build every row had a gap where the pills go — 083 is
     * not on prod, so no provider has tags, and the line is fixed-height
     * because `PROVIDER_ROW_HEIGHT` is a promise to FlashList. It read as a
     * rendering bug on every row.
     *
     * The fallback also restored something the rebuild had dropped without
     * anyone noticing: the previous row showed the headline on its second line,
     * and the tags took that slot.
     */
    const body = code(ROW);
    // Expertise is plain comma text now (Astrotalk parity), so tags OR the
    // headline fill the same line — an untagged provider still gets the
    // headline rather than a blank line.
    expect(body).toMatch(/tags\.length > 0 \? tags\.join\(', '\) : headline/);
    expect(body).toContain("'Here to listen'");
    // Still one line either way, which is the constraint that made collapsing
    // it impossible: the card height counts it.
    expect(between(body, 'testID={`provider-tags-${provider.id}`}', '</Text>')).toContain(
      "tags.join(', ')",
    );
  });

  it('states the avatar box, because inferring it hid the rating entirely', () => {
    /*
     * `Pressable` moves only the BOX keys (width, height, flex*, aspectRatio)
     * to the touchable root and gives the inner view `flexGrow: 1`.
     * `avatarTap` set none of them, so the root had no size of its own, grew to
     * the column, and pushed the rating and count past the clip:
     * `uiautomator` listed both Texts with inverted bounds while the screen
     * showed neither.
     *
     * Asserted on both styles, because either one alone leaves the row's
     * geometry inferred from content — and this list's whole invariant is that
     * it is not.
     */
    const tap = style('ring');
    expect(tap).toContain('width: ROW_AVATAR_RING');
    expect(tap).toContain('height: ROW_AVATAR_RING');
    const left = style('leftColumn');
    expect(left).toContain('width: ROW_AVATAR_RING');
    // The alignment-derived height, so the stars land on the CTA's centre. See
    // the alignment test above.
    expect(left).toContain('height: PROVIDER_ROW_LEFT_COLUMN');
    // And the constant it is stated in terms of is the same one the row height
    // is derived from, so the two cannot drift.
    expect(read(ROW)).toContain('const PROVIDER_ROW_LEFT_COLUMN');
  });
});

/*
 * #46: the CTA's verb as a table. The rule lives in `providerCtaLabel`
 * (src/lib/display.ts) so it can be CALLED here; the pin above asserts the row
 * uses it. Away outranks every channel; voice is a Call when the row can dial;
 * otherwise the verb names an offered channel, chat before video.
 */
describe('the provider row CTA label (#46)', () => {
  const on = true;
  const off = false;
  it.each([
    ['availability off', { isAvailable: off, audioEnabled: on, chatEnabled: on, canDial: true }, 'Notify'],
    ['availability off, video only', { isAvailable: off, audioEnabled: off, chatEnabled: off, canDial: true }, 'Notify'],
    ['voice on', { isAvailable: on, audioEnabled: on, chatEnabled: on, canDial: true }, 'Call'],
    ['voice on, chat off', { isAvailable: on, audioEnabled: on, chatEnabled: off, canDial: true }, 'Call'],
    ['voice off + chat on', { isAvailable: on, audioEnabled: off, chatEnabled: on, canDial: true }, 'Chat'],
    ['video only', { isAvailable: on, audioEnabled: off, chatEnabled: off, canDial: true }, 'Video'],
    ['voice on but no dial action, chat on', { isAvailable: on, audioEnabled: on, chatEnabled: on, canDial: false }, 'Chat'],
  ] as const)('%s -> %s', (_name, input, expected) => {
    expect(providerCtaLabel(input)).toBe(expected);
  });
});
