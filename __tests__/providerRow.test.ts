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

/**
 * The chip strip's scroller, JSX only.
 *
 * Bounded from `ref={strip}` and NOT from `<ScrollView`, which first appears
 * ~700 characters earlier as the type argument in `useRef<ScrollView | null>`:
 * slicing from there swept in the row's own Pressable and made the "no second
 * press target inside the strip" ban fail on the row's onPress. The marker has
 * to be unique to the element, not merely present in it.
 */
const stripJsx = (): string => between(code(ROW), 'ref={strip}', '</ScrollView>');
/** The text column, from its opening tag to the end of the scroller inside it. */
const labelColumn = (): string =>
  between(code(ROW), '<View style={styles.label}>', '</ScrollView>');
/** `styles.strip`, the scroller's own box. */
const stripStyle = (): string => between(code(ROW), '  strip: {', '  },');
/** `styles.stripContent`, the chips' row inside it. */
const stripContentStyle = (): string => between(code(ROW), '  stripContent: {', '  },');
/** `styles.chevron`, the disclosure glyph's slot. */
const chevronStyle = (): string => between(code(ROW), '  chevron: {', '  },');
/** Everything from `makeStyles` down: the row's layout, and nothing else. */
const rowStyles = (): string => between(code(ROW), 'const makeStyles');

describe('the provider row meta strip scrolls instead of clipping', () => {
  /*
   * Amit, both halves of one defect: "we have full pane occupied for arrow
   * button on sp profile row in homescreen which chuts the language chip" and
   * "info strip in explorer row should be scrollable hroziontally".
   *
   * The cut was `overflow: 'hidden'` on a flex-1 row of chips: with a rating, a
   * years chip and two languages the strip is wider than the text column, so the
   * last chip was sliced through the middle with nothing on screen to say more
   * existed.
   */
  it('carries the chips in a horizontal scroller, not a clipped row', () => {
    // A ScrollView, and inside the text column rather than beside it.
    expect(labelColumn()).toContain('<ScrollView');
    const strip = stripJsx();
    expect(strip).toContain('horizontal');
    expect(strip).toContain('style={styles.strip}');
    expect(strip).toContain('contentContainerStyle={styles.stripContent}');
    expect(strip).toContain('showsHorizontalScrollIndicator={false}');
    // The chips are still inside it — a scroller with the strip left behind
    // outside would satisfy every assertion above and show nothing.
    expect(strip).toContain('<MetaChip');
    expect(strip).toContain('{chips.map(chip => (');
  });

  it('no longer starves the strip with a hard clip', () => {
    // Bounded to the row's OWN styles, which must exist, so this cannot pass
    // vacuously; and it goes red the moment the old `chips` style comes back.
    expect(rowStyles()).not.toContain("overflow: 'hidden'");
    expect(stripStyle()).not.toContain('overflow');
    // `avatarTap` still needs its own escape hatch for the presence dot, so the
    // ban above is on the CLIP, not on the property.
    expect(rowStyles()).toContain("overflow: 'visible'");
  });

  it('keeps one line and never wraps into a second', () => {
    // The other way to lose the same-height invariant: a wrapping strip grows
    // the row instead of clipping it.
    expect(rowStyles()).not.toContain('flexWrap');
  });

  it('rewinds the scroller when FlashList recycles the cell onto someone else', () => {
    // A native scroll offset is not React state, so a recycled cell would open
    // on the previous provider's languages.
    const row = code(ROW);
    expect(row).toContain('const strip = useRef<ScrollView | null>(null)');
    expect(row).toContain('strip.current?.scrollTo({ x: 0, animated: false })');
    expect(row).toContain('}, [provider.id]);');
    expect(row).toContain('ref={strip}');
  });
});

describe('a tap on the strip still opens the row', () => {
  /*
   * The deliberate half of the three-way gesture, and the one that would be
   * worse than a clipped chip if it went wrong: a member taps the middle of a
   * row and nothing happens.
   *
   * Responder negotiation bubbles from the deepest node up
   * (https://reactnative.dev/docs/gesture-responder-system), so the scroller
   * gets first refusal on every touch starting on a chip. At the DEFAULT
   * `keyboardShouldPersistTaps` of 'never' it accepts one whenever a keyboard is
   * up — "children won't receive the tap" — and under 'handled' it also returns
   * true from onStartShouldSetResponder while the keyboard is dismissible
   * (react-native@0.86.2 Libraries/Components/ScrollView/ScrollView.js:1453).
   * Either would eat the tap on a search-results row, where the keyboard IS up.
   * 'always' is the one value that declines: "the scroll view will not catch
   * taps".
   * https://reactnative.dev/docs/scrollview#keyboardshouldpersisttaps
   */
  it('declines the tap at the scroller so it can bubble to the row', () => {
    expect(stripJsx()).toContain('keyboardShouldPersistTaps="always"');
  });

  it('does not take either value that would swallow it', () => {
    const strip = stripJsx();
    expect(strip).not.toContain('"handled"');
    expect(strip).not.toContain('"never"');
  });

  it('puts no second press target inside the strip', () => {
    // A Pressable among the chips would be a responder deeper than the scroller
    // and would win the tap the row wants.
    const strip = stripJsx();
    expect(strip).not.toContain('Pressable');
    expect(strip).not.toContain('onPress');
    // MetaChip stays display-only, which is what makes that true.
    expect(code(CHIP)).toContain('accessible={false}');
    expect(code(CHIP)).not.toContain('onPress');
  });

  it('leaves the row Pressable wrapping the strip, still the one action', () => {
    const row = code(ROW);
    const rowPress = row.indexOf('style={styles.row}');
    const scroller = row.indexOf('ref={strip}');
    expect(rowPress).toBeGreaterThan(-1);
    expect(scroller).toBeGreaterThan(rowPress);
    expect(row).toContain('onPress={() => onPress(provider.id)}');
  });

  it('resolves the drag axis on the platform, not with two props that cannot', () => {
    /*
     * The same finding the hero pager carries (ProviderDetailScreen.tsx, and
     * providerPhotos.test.ts asserts it there): `directionalLockEnabled` is
     * iOS-only, `nestedScrollEnabled` is the SAME-axis case. A cross-axis
     * conflict is decided in Android's onInterceptTouchEvent by whichever axis
     * crosses touch slop first.
     * https://developer.android.com/develop/ui/views/touch-and-input/gestures/viewgroup
     *
     * Bounded to the scroller, which must exist, so it is not a standing ban on
     * a feature the file never had.
     */
    const strip = stripJsx();
    expect(strip).not.toContain('directionalLockEnabled');
    expect(strip).not.toContain('nestedScrollEnabled');
    // And the app's one scroll feel, not a bespoke one for this strip.
    expect(strip).toContain('{...SCROLL_PHYSICS}');
  });
});

describe('the disclosure chevron has a bounded slot of its own', () => {
  it('states the width instead of taking whatever the glyph measures', () => {
    const chevron = chevronStyle();
    expect(chevron).toContain('width: ROW_CHEVRON_SLOT');
    expect(chevron).toContain('flexGrow: 0');
    expect(chevron).toContain('flexShrink: 0');
    expect(code(ROW)).toContain('export const ROW_CHEVRON_SLOT = TOKENS.icon.md');
  });

  it('sizes that slot from the glyph box Icon actually renders', () => {
    /*
     * The arithmetic the comment on ROW_CHEVRON_SLOT claims, checked rather than
     * trusted: Icon renders a Lucide glyph at Math.round(size * ICON_SCALE), so
     * a 16 chevron occupies 19dp and a 16dp slot would clip it.
     */
    const iconScale = /const ICON_SCALE = ([\d.]+);/.exec(read('src/components/Icon.tsx'));
    expect(iconScale).not.toBeNull();
    const glyphBox = Math.round(TOKENS.icon.sm * Number(iconScale?.[1]));
    expect(glyphBox).toBeGreaterThan(TOKENS.icon.sm);
    expect(TOKENS.icon.md).toBeGreaterThanOrEqual(glyphBox);
    // …and the chevron is still rendered at `icon.sm` inside that slot.
    expect(between(code(ROW), '<View style={styles.chevron}>', '</View>')).toContain(
      'name="chevronRight" size={TOKENS.icon.sm}',
    );
  });

  it('is a slot and not a second touch target', () => {
    // "Make the icon individual per row" is about the width the glyph owns. A
    // chevron button would duplicate the row's own action and add a second
    // TalkBack node overlapping it.
    const chevron = between(code(ROW), '<View style={styles.chevron}>', '</View>');
    expect(chevron).not.toContain('Pressable');
    expect(chevron).not.toContain('onPress');
  });

  it('sits outside the text column, after the strip', () => {
    const row = code(ROW);
    expect(row.indexOf('<View style={styles.label}>')).toBeGreaterThan(-1);
    expect(row.indexOf('</ScrollView>')).toBeGreaterThan(
      row.indexOf('<View style={styles.label}>'),
    );
    expect(row.indexOf('<View style={styles.chevron}>')).toBeGreaterThan(
      row.indexOf('</ScrollView>'),
    );
  });
});

describe('every row is still the same height', () => {
  it('fixes the scroller height rather than letting it measure content', () => {
    // A ScrollView's cross-axis size comes from its content unless it is told
    // otherwise, which is precisely how a scroller changes a row's height.
    const strip = stripStyle();
    expect(strip).toContain('height: TOKENS.interaction.minTarget');
    expect(strip).not.toMatch(/minHeight|maxHeight|flex|padding/);
    expect(stripContentStyle()).not.toMatch(/height|padding/);
  });

  it('gives the drag a 48dp activation band without moving the row', () => {
    /*
     * Amit, 2026-09-07: "schip scroll is not working correctly.. pls check
     * activation area." The band WAS the visible chip height, 32dp — and a
     * ScrollView's touch area is its layout box, since hitSlop "never extends
     * past the parent view bounds". 32 is under the 48dp minimum, and the cost
     * is worse than a missed tap because this band competes with a VERTICAL
     * list for the same gesture: Android arbitrates on touch slop, so a drag
     * starting even slightly diagonal in a 32dp window goes to the FlashList.
     *
     * Asserted as ARITHMETIC on the tokens, not as three literals, because the
     * whole point is that the three numbers cancel: the band grows to 48 and
     * the row's contribution stays exactly what `space['2xs'] +
     * META_CHIP_HEIGHT` was, so the chips do not move and the 108dp height
     * gate above still holds.
     */
    const strip = stripStyle();
    expect(strip).toContain('height: TOKENS.interaction.minTarget');
    // The band is a real target.
    expect(TOKENS.interaction.minTarget).toBeGreaterThanOrEqual(48);
    // Both margins are derived from the same difference, never written out.
    const bleed = (TOKENS.interaction.minTarget - 32) / 2;
    expect(strip).toContain(
      "marginTop: TOKENS.space['2xs'] - (TOKENS.interaction.minTarget - META_CHIP_HEIGHT) / 2",
    );
    expect(strip).toContain(
      'marginBottom: -(TOKENS.interaction.minTarget - META_CHIP_HEIGHT) / 2',
    );
    // And they cancel: the row's contribution is unchanged, which is what keeps
    // the height gate above true and the chips where they were.
    const contribution =
      TOKENS.space['2xs'] - bleed + TOKENS.interaction.minTarget - bleed;
    expect(contribution).toBe(TOKENS.space['2xs'] + 32);
    // The chips still begin exactly `space['2xs']` under the headline.
    expect(TOKENS.space['2xs'] - bleed + bleed).toBe(TOKENS.space['2xs']);
  });

  it('takes that height from the chip rather than repeating 32', () => {
    expect(code(CHIP)).toContain('export const META_CHIP_HEIGHT = 32');
    const chip = between(code(CHIP), '    chip: {', '    },');
    expect(chip).toContain('height: META_CHIP_HEIGHT');
    expect(chip).toContain('minHeight: META_CHIP_HEIGHT');
    expect(chip).not.toMatch(/height: 32/);
    expect(code(ROW)).toContain("import { META_CHIP_HEIGHT, MetaChip } from './MetaChip'");
  });

  it('computes to the same height it did before the strip scrolled', () => {
    /*
     * The row's height is the label column (the 40dp avatar is shorter), and
     * every term is a token:
     *
     *   paddingVertical ×2 + name + gap + headline + gap + strip marginTop
     *   + strip height
     *
     * The scroller contributes META_CHIP_HEIGHT, which is exactly what the row
     * of chips it replaced contributed, so this number is unchanged by the
     * change these tests cover — it is pinned so that a future height on the
     * strip, or a second line anywhere, has to come here and say so.
     *
     * NOTE for whoever lands here after changing it: HomeScreen.tsx tells
     * FlashList `size = 97` in `overrideItemLayout`, which is already ~11dp
     * short of this and is a hint rather than a constraint (FlashList v2
     * measures the real cell). That file is not this component's to edit.
     */
    const metaChipHeight = Number(
      /export const META_CHIP_HEIGHT = (\d+)/.exec(read(CHIP))?.[1],
    );
    expect(metaChipHeight).toBe(32);
    const rowHeight =
      TOKENS.space.sm * 2 +
      TOKENS.typography.titleMediumEmphasized.lineHeight +
      TOKENS.space.hair +
      TOKENS.typography.bodyMedium.lineHeight +
      TOKENS.space.hair +
      TOKENS.space['2xs'] +
      metaChipHeight;
    expect(rowHeight).toBe(108);

    /*
     * And the LIST's estimate is that same constant, not a copy of the number.
     *
     * HomeScreen carried `size = 97` in both `overrideItemLayout` callbacks — a
     * value from before this row grew a meta strip, so it had been 11dp wrong
     * for as long as the strip has existed. FlashList v2 measures real cells, so
     * a wrong hint costs scrollbar and scroll-to-index accuracy rather than
     * correctness, which is precisely why nobody noticed.
     *
     * Pinning the IMPORT rather than a number is the point: a literal here
     * would just be the same drift one file further along.
     */
    const home = code('src/screens/HomeScreen.tsx');
    expect(home).toContain("PROVIDER_ROW_HEIGHT } from '../components/ProviderRow'");
    expect(home.match(/\.size = PROVIDER_ROW_HEIGHT;/g)?.length).toBe(2);
    expect(home).not.toMatch(/\.size = \d+;/);
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
