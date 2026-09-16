import { readFileSync } from 'fs';
import { join } from 'path';
import { TOKENS } from '../src/theme/tokens';
import { genderLetter } from '../src/lib/display';

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
    expect(read(ROW)).toContain('export const ROW_AVATAR = 76');
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
    expect(style('leftColumn')).toContain('height: PROVIDER_ROW_RIGHT_COLUMN');
  });

  it('lands the stars on the price line, the way the reference does', () => {
    /*
     * Astrotalk's `average_ratingbar` sits at y384.4 and its `price` at y386.5
     * — two points apart, so the rating and the rate read as one line across
     * the card. Amit, on the device: "strats should align with rate.. pls see
     * how astrotalsk proved space and alignment".
     *
     * Achieved structurally rather than by a tuned offset: the left column
     * takes the right column's height and pushes exactly two children apart, so
     * the ring pins to the top and the rating block to the bottom. A hardcoded
     * `marginTop` would have produced the same pixels today and drifted the
     * first time a line was added to the other side.
     *
     * The arithmetic, from the constants above:
     *   stars centre = 136 − (14 + 2 + 16) + 14/2 = 111
     *   price centre = (24+2+24+2+16+2+16+2) + 48/2 = 112
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

    const starsHeight = Math.round(TOKENS.icon.xs * 1.2);
    const ratingBlock = starsHeight + TOKENS.space.hair + TOKENS.typography.bodySmall.lineHeight;
    const right =
      TOKENS.typography.titleMediumEmphasized.lineHeight +
      TOKENS.space.hair +
      24 +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight +
      TOKENS.space.hair +
      TOKENS.interaction.minTarget;
    const starsCentre = right - ratingBlock + starsHeight / 2;
    const priceCentre = right - TOKENS.interaction.minTarget + TOKENS.interaction.minTarget / 2;
    expect(Math.abs(starsCentre - priceCentre)).toBeLessThanOrEqual(2);
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
     * already had. `badge-check` is Lucide's scalloped rosette, the mark both
     * Clarity and Astrotalk draw, added through design/icons.json and
     * regenerated rather than hand-edited (RULE 4).
     */
    expect(code(ROW)).toContain("name=\"badgeCheck\"");
    expect(code(ROW)).not.toContain('styles.verified');
    expect(read('design/icons.json')).toContain('"badgeCheck": "badge-check"');
    expect(read('src/theme/icons.generated.ts')).toContain('badgeCheck:');
    // Out of the accessibility tree: the card's label would otherwise gain a
    // stop that says nothing a member can act on.
    expect(code(ROW)).toMatch(/testID="provider-verified"[\s\S]{0,60}badgeCheck/);
    expect(code(ROW)).toMatch(/accessible=\{false\} testID="provider-verified"/);
    // And the guarantee it rests on is real, checked against the migration
    // rather than trusted from the comment.
    expect(read('supabase/migrations/083_provider_expertise.sql')).toContain(
      'p.identity_verified_at is not null',
    );
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
    expect(body).toMatch(/`Notify \$\{provider\.display_name\} that you want to chat`/);
    expect(body).toMatch(/`Call \$\{provider\.display_name\}`/);
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

describe('the CTA is 48dp, and the reference is the thing that is wrong', () => {
  it('draws the CTA at Astrotalk 36dp but keeps the 48dp target', () => {
    /*
     * Astrotalk's `call_rl` is 36.0×95.3dp on the Redmi. The button is DRAWN at
     * 36 to match (Amit, on the S22: "make the call cta smaller"), but the 48dp
     * touch minimum still applies with full force — this really is inside the
     * row's tappable area. So the target stays 48 two ways: the price ROW it
     * sits in is ROW_CTA_HEIGHT (48) and the button is centred in it, and the
     * Pressable's `size={ROW_CTA_VISUAL_HEIGHT}` inflates the focusable area back
     * to 48 via hitSlop without inflating the visual.
     */
    expect(read(ROW)).toContain('export const ROW_CTA_HEIGHT = TOKENS.interaction.minTarget');
    expect(read(ROW)).toContain('export const ROW_CTA_VISUAL_HEIGHT = 36');
    expect(code(ROW)).toContain('size={ROW_CTA_VISUAL_HEIGHT}');
    expect(TOKENS.interaction.minTarget).toBe(48);
    /*
     * The WIDTH left the reference on 2026-09-08: 136, not Astrotalk's 95.3,
     * because the button now carries the rate as well as the verb ("move rate
     * into cta after call text"). A width is safe to change — nothing about it
     * is a platform minimum — and the room is needed.
     */
    expect(read(ROW)).toContain('export const ROW_CTA_WIDTH = 136');
    // The rate is INSIDE the control, and there is no longer a price line.
    expect(code(ROW)).toContain('styles.ctaRate');
    expect(code(ROW)).not.toContain('styles.price,');
    const cta = style('cta');
    expect(cta).toContain('height: ROW_CTA_VISUAL_HEIGHT');
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
    /*
     * One rate, through `RupeeAmount` on the card and `formatRupees` in the
     * spoken label — the ₹ glyph sweep (2026-09-08) moved the visible figure
     * off a raw `formatRupees(...)` call so the glyph could render in a lighter
     * weight than the digits, without touching what TalkBack hears.
     */
    expect(body).toContain('<RupeeAmount value={ratePerMin}');
    expect(body).toContain('formatRupees(ratePerMin)'); // the spoken label
    expect(body.match(/formatRupees\(/g)?.length).toBe(1);
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
    expect(body).toContain("const away = !presence.here");
    expect(body).toContain(
      "const ctaLabel = away ? 'Notify' : canCall ? 'Call' : 'Chat'",
    );
    expect(body).toMatch(/canCall && onCall !== undefined \? onCall\(provider\.id\) : onPress\(provider\.id\)/);
  });

  it('drops the glyph in front of the price, except the away bell', () => {
    /*
     * Amit: "remove call icon before 22/min". It was doing less than it looked
     * — the phone said "this rate buys a call", which the CTA beside it now
     * says in a word.
     *
     * NARROWED 2026-09-13 for the away state, and the distinction is the reason
     * the original rule exists rather than an exception to it. The banned phone
     * glyph was REDUNDANT: it said the same thing as the word "Call" beside it.
     * The bell is not redundant — it says something the word cannot, that this
     * row offers a different KIND of action from every other row in the list.
     * The test asserts that difference rather than just allowing an Icon back:
     * the only glyph permitted here is the bell, and only in the away branch.
     */
    const priceLine = between(code(ROW), '<View style={styles.priceLine}>', '</View>');
    /*
     * The glyph became an EXPRESSION on 2026-09-17: the bell turns into a check
     * once the peer has actually been told, which is the visible half of the
     * Notify state machine. A name="..." only match would find nothing and pass
     * an empty array, so it matches both forms and the permitted set is still
     * asserted exactly. Neither branch may be the banned phone glyph.
     */
    const icons = priceLine.match(/<Icon\s+name=(?:"\w+"|\{[^}]+\})/g) ?? [];
    expect(icons).toEqual([
      "<Icon\n                    name={notified ? 'check' : 'bell'}",
    ]);
    // ...and it is gated on away, never drawn for a provider who is here.
    expect(priceLine).toContain('{away ? (');
    expect(priceLine).toContain('<RupeeAmount value={ratePerMin}');
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
    /*
     * The cap now lives entirely in `rowExpertise`, where the row used to
     * re-apply it after prepending the category badge. The badge moved to its
     * own slot on the price line, so there is nothing to prepend and nothing to
     * re-slice — and the topics got back the slot the badge was taking in
     * search.
     */
    expect(code('src/lib/expertise.ts')).toContain('export const ROW_EXPERTISE_LIMIT = 3');
    expect(code(ROW)).toContain('const tags = rowExpertise(provider)');
    expect(code(ROW)).not.toContain('.slice(0, ROW_EXPERTISE_LIMIT)');
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

  it('computes to a 160dp card and a 168dp pitch, from the tokens', () => {
    /*
     * The card is TWO columns of different heights — the shape the reference
     * uses and the reason the avatar grew. Every term is a token, so a change
     * to the type scale or a chip height fails here rather than silently
     * mis-hinting the list.
     *
     *   left   ring 84 · 8 · stars 14 · 2 · count 16                          = 124
     *   right  name 24 · 2 · tags 24 · 2 · langs 16 · 2 · exp 16 · 2 · CTA 48 = 136
     *
     * The last line is a ROW — price left, CTA right — so it costs the CTA's 48
     * rather than 48 plus the price's own 20. Astrotalk does the same: its
     * `call_rl` spans y361.5–397.5, straddling the lines rather than sitting
     * under them.
     *
     * 160 of card against the reference's 146.2dp `row_content_holder`, and 168
     * of pitch against their 180.4 — which is where "increase row height for
     * comfortable view" landed, inside the reference's own bracket.
     *
     * THIS TEST USED TO PASS WHILE DESCRIBING THE WRONG ROW. It recomputed the
     * old four-line stack from tokens and asserted 142, and the arithmetic
     * still came to 142 after the component became a five-line card — because
     * it never read the component. The import below is the fix: the expected
     * value now comes from the same constants the row lays itself out with, so
     * the test cannot agree with itself while disagreeing with the screen.
     */
    const smallChip = Number(/export const META_CHIP_HEIGHT_SM = (\d+)/.exec(read(CHIP))?.[1]);
    expect(smallChip).toBe(24);

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

    const left =
      ringSize +
      TOKENS.space.xs +
      starsHeight +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight;
    const right =
      TOKENS.typography.titleMediumEmphasized.lineHeight +
      TOKENS.space.hair +
      smallChip +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight +
      TOKENS.space.hair +
      TOKENS.typography.bodySmall.lineHeight +
      TOKENS.space.hair +
      TOKENS.interaction.minTarget;
    /*
     * The left column FITS; it no longer sizes the card. Astrotalk aligns its
     * rating bar with its price line (y384.4 against y386.5), and top-aligning
     * two columns of different heights cannot do that — the stars landed 13dp
     * high and the card had two horizons. The left column now takes the RIGHT
     * column's height and pushes its two children apart, so the ring stays at
     * the top and the stars fall level with the price.
     *
     * What still matters is that the contents fit inside that height. If they
     * ever exceed it the stars would be pushed out of the card, which is the
     * same class of silent clipping the ring's missing box caused.
     */
    expect(left).toBe(124);
    expect(right).toBe(136);
    expect(left).toBeLessThanOrEqual(right);

    /*
     * ...and the COMPONENT'S OWN FORMULA, term for term, which is the half the
     * previous version was missing. The numbers above are this test's
     * arithmetic; these are the row's. If the stack gains or loses a line, the
     * text below stops matching even when the total happens to survive.
     */
    const src = read(ROW);
    const leftFormula = between(src, 'export const PROVIDER_ROW_LEFT_COLUMN =', ';');
    expect(leftFormula).toContain('ROW_AVATAR_RING');
    expect(leftFormula).toContain('STARS_HEIGHT');
    expect(leftFormula).toContain('RING_TO_STARS');
    expect(read(ROW)).toContain('const RING_TO_STARS = TOKENS.space.xs');
    expect(leftFormula.match(/TOKENS\./g)?.length).toBe(2);

    const rightFormula = between(src, 'export const PROVIDER_ROW_RIGHT_COLUMN =', ';');
    expect(rightFormula).toContain('titleMediumEmphasized.lineHeight');
    expect(rightFormula).toContain('ROW_TAG_LINE');
    expect(rightFormula).toContain('ROW_CTA_HEIGHT');
    // Two bodySmall lines — languages AND experience. One would mean a line got
    // dropped while the total still looked plausible.
    expect(rightFormula.match(/bodySmall\.lineHeight/g)?.length).toBe(2);
    // Four hair gaps, one between each pair of the five line items.
    expect(rightFormula.match(/TOKENS\.space\.hair/g)?.length).toBe(4);

    expect(src).toContain('PROVIDER_CARD_HEIGHT = CARD_PAD * 2 + PROVIDER_ROW_RIGHT_COLUMN');
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
    expect(home.match(/ratePerMin=\{ratePerMin\}/g)?.length).toBe(2);
  });

  it('leaves the card top-aligned, since the columns differ', () => {
    // `center` would float the 120dp avatar column down from the name it
    // belongs to. Astrotalk top-aligns for the same reason.
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
    // The bounded, wrapping call site the ban protects.
    expect(code('src/components/ProviderCard.tsx')).toContain("flexWrap: 'wrap'");
  });
});

describe('the tag line always has something in it', () => {
  /*
   * BOTH ASSERTIONS HERE COME FROM A DEVICE BUILD, not from review, and neither
   * would have failed anything before it. That is the whole of RULE 2 in one
   * suite: `npm run verify` was green, 1608 tests passed, and the row on the
   * Redmi was visibly wrong in two ways.
   */
  it('falls back to the headline, so an untagged provider is not a 24dp hole', () => {
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
    // headline fill the same fixed-height slot — an untagged provider still gets
    // the headline rather than a 24dp hole.
    expect(body).toMatch(/tags\.length > 0 \? tags\.join\(', '\) : headline/);
    expect(body).toContain("'Here to listen'");
    // Still one fixed-height line either way, which is the constraint that made
    // collapsing it impossible.
    expect(style('tagLine')).toContain('height: ROW_TAG_LINE');
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
    // The RIGHT column's height — the two share a bottom edge so the stars land
    // on the price line. See the alignment test above.
    expect(left).toContain('height: PROVIDER_ROW_RIGHT_COLUMN');
    // And the constant it is stated in terms of is the same one the row height
    // is derived from, so the two cannot drift.
    expect(read(ROW)).toContain('export const PROVIDER_ROW_LEFT_COLUMN');
  });
});
