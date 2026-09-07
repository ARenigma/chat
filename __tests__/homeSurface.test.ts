import { readFileSync } from 'fs';
import { join } from 'path';
import { DARK, LIGHT, TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Source with comments removed, and it is MANDATORY in this file.
 *
 * Every string these tests look for — `48`, `40`, `FragmentSearchField.java`,
 * `Top rated`, `text/section` — also appears in the long comments that explain
 * why the value is what it is. This repo has produced a FALSE GATE three times
 * by grepping a file and matching its own documentation, so the source is
 * stripped first and, where a claim is about one block, the slice is bounded to
 * that block as well.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** WCAG 2.1 relative luminance, same arithmetic as scripts/check-contrast.mjs. */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('the search field is the one Telegram actually ships', () => {
  const bar = withoutComments(read('src/components/SearchBar.tsx'));
  const styles = bar.slice(bar.indexOf('container: {'));

  it('is a 40dp pill inside a 48dp row, not an M3 56dp bar', () => {
    /*
     * Everything this component used to be was measured off the M3 docked search
     * bar (56dp, radius 28) and everything the MOTION was measured off came from
     * ActionBar/ActionBarMenuItem.java — Telegram's LEGACY action-bar search,
     * which the dialogs list stopped using several versions ago. The field it
     * ships is Components/FragmentSearchField.java, built at
     * DialogsActivity.java:3285 and added at :5344 inside a row whose height is
     * SEARCH_FIELD_HEIGHT = 48 (:295), padded 4dp on every side (:3294) to leave
     * a 40dp pill with a dp(20) corner (FragmentSearchField.java:275).
     *
     * The 48dp row is also the Android minimum touch target, which the 40dp pill
     * is not — https://developer.android.com/guide/topics/ui/accessibility/apps
     */
    expect(bar).toContain('export const SEARCH_ROW_HEIGHT = 48');
    expect(bar).toContain('export const SEARCH_PILL_HEIGHT = 40');
    expect(bar).toContain('const GLYPH_BOX = 24');
    expect(bar).toContain('const GLYPH_INSET = 12');
    expect(styles).toContain('height: SEARCH_ROW_HEIGHT');
    expect(styles).toContain('borderRadius: SEARCH_PILL_HEIGHT / 2');
    // The pill is painted behind the row rather than being the row, because
    // hitSlop "never extends past the parent view bounds"
    // (https://reactnative.dev/docs/view#hitslop).
    expect(styles).toContain('pill: {');
    expect(styles).toContain("position: 'absolute'");
    // And the M3 number it replaced is gone, not merely unused.
    expect(bar).not.toContain('SEARCH_BAR_HEIGHT');
  });

  it('holds the text inset constant while you type, the way FragmentSearchField does', () => {
    /*
     * The defect a member can feel. The clear button used to be conditionally
     * MOUNTED (`value.length > 0 ? <Pressable size={36}> : null`), so the input's
     * right inset flipped between 16dp and 64dp and the caret jumped sideways on
     * the first keystroke and again on clear. Telegram recomputes `pEnd` as
     * `dp(48) + additionalIcons` unconditionally (FragmentSearchField.java:242)
     * and only ever animates the glyph's alpha, scale and rotation (:330-333).
     *
     * That 48 is now spent as ONE 48dp slot at each end rather than as 12dp of
     * row padding + a 24dp glyph + a 12dp input margin. Same pixels, and the
     * next test is why it had to move: only the one-box version can also be a
     * touch target.
     */
    expect(bar).toContain('const GLYPH_SLOT = GLYPH_INSET * 2 + GLYPH_BOX');
    expect(styles).toContain('width: GLYPH_SLOT');
    // The inset lives INSIDE the slots now, so nothing else may add to it.
    expect(styles).not.toContain('paddingHorizontal');
    expect(styles).not.toContain('marginHorizontal');
    expect(styles).not.toContain('gap: TOKENS.space.sm');
    // The slot is laid out always; only its opacity/scale/rotation change.
    expect(bar).toContain('const clearTarget = value.length > 0 ? 1 : 0');
    expect(bar).not.toMatch(/value\.length > 0 \?\s*\(?\s*<Pressable/);
  });

  it('gives the clear control a real 48dp box, and nothing to hit when the field is empty', () => {
    /*
     * The defect: for a day the clear control was a 24dp `Pressable`
     * (`size={GLYPH_BOX}`) inside a content-sized `Animated.View`, so its 12dp
     * of `hitSlop` was clipped away to nothing — "the touch area never extends
     * past the parent view bounds" (https://reactnative.dev/docs/view#hitslop).
     * Effective target 24x24dp, against Android's "we recommend that each
     * interactive UI element have a focusable area, or touch target size, of at
     * least 48dp x 48dp"
     * (https://developer.android.com/guide/topics/ui/accessibility/apps).
     *
     * The arithmetic is read out of the source as VALUES and compared with
     * `interaction.minTarget`, so shrinking GLYPH_INSET or GLYPH_BOX fails here
     * rather than quietly halving the target. No `hitSlop` appears in the file
     * at all: the slot is a laid-out 48dp box, which is the only version that
     * cannot be clipped by an ancestor.
     */
    const inset = Number(/const GLYPH_INSET = (\d+)/.exec(bar)?.[1]);
    const box = Number(/const GLYPH_BOX = (\d+)/.exec(bar)?.[1]);
    expect(inset * 2 + box).toBe(TOKENS.interaction.minTarget);
    expect(TOKENS.interaction.minTarget).toBe(48);
    // Declared on the wrapper AND on the Pressable, so neither can clip the
    // other by accident.
    expect(bar).toContain('style={[styles.clearSlot, clearStyle]}');
    expect(bar).toContain('style={styles.clearTarget}');
    expect(bar).toContain('size={GLYPH_SLOT}');
    expect(bar).not.toContain('hitSlop');
    const slots = bar.slice(bar.indexOf('clearSlot: {'), bar.indexOf('input: {'));
    expect(slots.match(/width: GLYPH_SLOT/g)?.length).toBe(2);
    expect(slots.match(/height: SEARCH_ROW_HEIGHT/g)?.length).toBe(2);

    /*
     * And an always-mounted 48dp control over the right-hand end of the text
     * field has to be INERT while there is nothing to clear, on both channels.
     * `pointerEvents="none"` — "The View is never the target of touch events",
     * and unlike `box-none` it does not re-enable its subviews
     * (https://reactnative.dev/docs/view#pointerevents).
     * `importantForAccessibility="no-hide-descendants"` — "The view is not
     * important for accessibility, nor are any of its descendant views"
     * (https://reactnative.dev/docs/view#importantforaccessibility). That is
     * the ANDROID prop, which is the only one that matters in an Android-only
     * app; `accessibilityElementsHidden` is the iOS one and would be a no-op.
     */
    expect(bar).toContain("pointerEvents={hasText ? 'auto' : 'none'}");
    expect(bar).toContain(
      "importantForAccessibility={hasText ? 'yes' : 'no-hide-descendants'}",
    );
    expect(bar).not.toContain('accessibilityElementsHidden');
    // `disabled` would be the wrong tool: it routes into Pressable's 45%
    // opacity dim and announces "disabled", i.e. it would report a BROKEN clear
    // button rather than no clear button.
    expect(bar).not.toContain('disabled={');
  });

  it('reveals the clear glyph on the reference curve, from a token', () => {
    /*
     * 380ms on CubicBezierInterpolator.EASE_OUT_QUINT (0.23, 1, 0.32, 1) —
     * FragmentSearchField.java:57, CubicBezierInterpolator.java:13 — with
     * `alpha = f; scale = lerp(0.4, 1, f)` (FragmentFloatingButton.java:250-258)
     * and `setRotation((1 - factor) * 90)` (FragmentSearchField.java:333).
     *
     * The duration is a token, so "make search calmer" stays one edit; only the
     * bezier is rebuilt locally, from motion.m3.easing.easeOutQuint, because
     * src/theme/motion.ts keeps its own copy module-private.
     */
    expect(TOKENS.motion.duration.clearReveal).toBe(380);
    expect(TOKENS.motion.m3.easing.easeOutQuint).toEqual([0.23, 1, 0.32, 1]);
    expect(bar).toContain('TOKENS.motion.duration.clearReveal');
    expect(bar).toContain('TOKENS.motion.m3.easing.easeOutQuint');
    expect(bar).toContain('const CLEAR_HIDDEN_SCALE = 0.4');
    expect(bar).toContain('const CLEAR_HIDDEN_ROTATION_DEG = 90');
    // Both glyph boxes are 24dp: Icon.tsx renders at round(size * 1.2), so the
    // trailing icon is size 20 (-> 24), not the 18 (-> 22) it used to be.
    expect(bar).toContain('<Icon name="close" size={20}');
  });

  it('paints the pill with a measurable token, and says so as a departure', () => {
    /*
     * Telegram composites the fill out of the text ink —
     * `getThemedColor(key_windowBackgroundWhiteBlackText, isDark ? 0.07f :
     * 0.05f)`, FragmentSearchField.java:275. This app uses the solid `bg/sunken`
     * instead, because `scripts/check-contrast.mjs` measures declared token
     * PAIRS and cannot see a composited opacity: a translucent fill would put
     * the field's background — what the placeholder, the input text and both
     * glyphs are measured against — outside every contrast check in the repo.
     *
     * That is a real departure from a reference this file's own table records,
     * so RULE 1 §6 requires it to be NAMED next to the code. This gate holds the
     * disclosure, not the colour: a future pass that switches to a composite
     * must come back here and re-argue it.
     */
    expect(styles).toContain('backgroundColor: t.color.bg.sunken');
    const header = read('src/components/SearchBar.tsx').slice(
      0,
      read('src/components/SearchBar.tsx').indexOf('Docked = inline'),
    );
    expect(header).toContain('Departs from Telegram, on purpose:');
    const departures = header.slice(header.indexOf('Departs from Telegram'));
    expect(departures).toContain('THE PILL FILL IS A SOLID TOKEN');
    expect(departures).toContain('FragmentSearchField.java:275');
    expect(departures).toContain('check-contrast.mjs');
    // The ripple is the second undeclared departure the audit found; it is
    // Telegram's own createSelectorDrawable, but at our radius token, not dp(17).
    expect(bar).toContain('highlight="ripple"');
    expect(departures).toContain('FragmentSearchField.java:278');
  });
});

describe('search MOVES the way Telegram moves it, not only measures like it', () => {
  const motion = withoutComments(read('src/theme/motion.ts'));
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));

  it('spends the corrected durations in motion.ts, and retires the wrong one', () => {
    /*
     * This gate used to read design/tokens.json and TOKENS only, which meant it
     * passed while the three tokens it names had NO consumer anywhere in src/ —
     * the exact condition the audit objected to. It is now bound to the
     * consumer: the values still have to be right, and something has to spend
     * them.
     *
     * ADR-0025 §3: every adopted value names its File.ext:line.
     *   searchField 350 — BoolAnimator animatorSearchVisible, EASE_OUT_QUINT,
     *                     DialogsActivity.java:307-308
     *   searchEnter 200 / searchExit 180 — searchAnimator.setDuration(show ?
     *                     200 : 180), DialogsActivity.java:7590
     *   clearReveal 380 — BoolAnimator animatorCloseIconVisible,
     *                     FragmentSearchField.java:57
     */
    expect(TOKENS.motion.duration.searchField).toBe(350);
    expect(TOKENS.motion.duration.searchEnter).toBe(200);
    expect(TOKENS.motion.duration.searchExit).toBe(180);
    expect(TOKENS.motion.duration.clearReveal).toBe(380);
    expect(motion).toContain('FadeIn.duration(DURATION.searchField)');
    expect(motion).toContain('FadeOut.duration(DURATION.searchField)');
    expect(motion).toContain('DURATION.searchEnter');
    expect(motion).toContain('DURATION.searchExit');
    // And the 150 that was measured off the LEGACY ActionBarMenuItem class is
    // deleted rather than parked: a duration nothing reads is a duration the
    // next reader will believe.
    expect(read('design/tokens.json')).not.toContain('"searchToggle"');
    expect(motion).not.toContain('searchToggle');
    expect(motion).not.toContain('ActionBarMenuItem');
  });

  it('crossfades the nav row on EASE_OUT_QUINT, not on the default inOut(quad)', () => {
    /*
     * Reanimated's withTiming defaults to `Easing.inOut(Easing.quad)`
     * (https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming),
     * a symmetric ease — so a builder with no `.easing()` was not "close to" the
     * reference, it was a different curve family. EASE_OUT_QUINT is
     * (.23, 1, .32, 1), CubicBezierInterpolator.java:13, and the animator that
     * carries the field is 350ms on it (DialogsActivity.java:307-308).
     */
    expect(TOKENS.motion.m3.easing.easeOutQuint).toEqual([0.23, 1, 0.32, 1]);
    expect(motion).toMatch(
      /const EASE_OUT_QUINT = Easing\.bezier\(\s*M3\.easing\.easeOutQuint\[0\]/,
    );
    const crossfade = motion.slice(
      motion.indexOf('export const searchIn'),
      motion.indexOf('const SEARCH_RESULTS_AWAY'),
    );
    expect(crossfade).toMatch(
      /searchIn = FadeIn\.duration\(DURATION\.searchField\)\s*\.easing\(EASE_OUT_QUINT\)/,
    );
    expect(crossfade).toMatch(
      /searchOut = FadeOut\.duration\(DURATION\.searchField\)\s*\.easing\(EASE_OUT_QUINT\)/,
    );
    expect(home).toContain('entering={searchIn}');
    expect(home).toContain('exiting={searchOut}');
  });

  it('swaps the content underneath on the second animator, scales and close delay included', () => {
    /*
     * The half that was missing entirely: `searchAnimator`, 200ms opening /
     * 180ms closing on CubicBezierInterpolator.EASE_OUT with a 20ms start delay
     * on the close only (DialogsActivity.java:7554-7607, :7590-7594). The
     * results ride ABOVE at 1.05 (:7602-7603) and the directory BELOW at 0.95
     * (:7556-7557), each arriving toward 1 and leaving back to its own away
     * scale.
     *
     * Which token each half takes is deliberate and is asserted, because it
     * looks like a bug: the reference times the whole AnimatorSet by the
     * direction of the SESSION, so entering search is 200ms for both the results
     * arriving and the directory leaving.
     */
    expect(TOKENS.motion.m3.easing.easeOut).toEqual([0, 0, 0.58, 1]);
    const swap = motion.slice(
      motion.indexOf('const SEARCH_RESULTS_AWAY'),
      motion.indexOf('export const barIn'),
    );
    expect(swap).toContain('const SEARCH_RESULTS_AWAY = 1.05');
    expect(swap).toContain('const SEARCH_DIRECTORY_AWAY = 0.95');
    expect(swap).toContain('const SEARCH_CLOSE_DELAY_MS = 20');
    expect(swap).toMatch(
      /searchResultsIn = contentArrive\(\s*SEARCH_RESULTS_AWAY,\s*DURATION\.searchEnter,\s*0,?\s*\)/,
    );
    expect(swap).toMatch(
      /searchResultsOut = contentLeave\(\s*SEARCH_RESULTS_AWAY,\s*DURATION\.searchExit,\s*SEARCH_CLOSE_DELAY_MS,?\s*\)/,
    );
    expect(swap).toMatch(
      /directoryIn = contentArrive\(\s*SEARCH_DIRECTORY_AWAY,\s*DURATION\.searchExit,\s*SEARCH_CLOSE_DELAY_MS,?\s*\)/,
    );
    expect(swap).toMatch(
      /directoryOut = contentLeave\(\s*SEARCH_DIRECTORY_AWAY,\s*DURATION\.searchEnter,\s*0,?\s*\)/,
    );
    // Both channels animate, and both are on the reference's curve.
    expect(swap).toMatch(/initialValues: \{ opacity: 0, transform: \[\{ scale: away \}\] \}/);
    expect(swap).toMatch(/initialValues: \{ opacity: 1, transform: \[\{ scale: 1 \}\] \}/);
    expect(swap.match(/easing: EASE_OUT,/g)?.length).toBe(4);
    expect(swap.match(/withDelay\(/g)?.length).toBe(4);
  });

  it('stacks the two layers, so an exiting list cannot halve the column', () => {
    /*
     * FlashList styles its own scroll view `flex: 1` for a vertical list
     * (@shopify/flash-list RecyclerView.js:340) and a Reanimated `exiting`
     * animation keeps the leaving view in the layout tree until it finishes. As
     * plain flex siblings the outgoing and incoming lists would each take HALF
     * the column for the whole 200ms, so the swap would read as a squash rather
     * than a dissolve. The reference stacks them too: `searchViewPager` and
     * `viewPages[0]` are siblings in one FrameLayout.
     */
    expect(home).toContain('entering={searchResultsIn}');
    expect(home).toContain('exiting={searchResultsOut}');
    expect(home).toContain('entering={directoryIn}');
    expect(home).toContain('exiting={directoryOut}');
    expect(home.match(/style=\{styles\.swapLayer\}/g)?.length).toBe(3);
    const stack = home.slice(home.indexOf('swap: {'), home.indexOf('state: {'));
    expect(stack).toContain('flex: 1');
    expect(stack).toContain('StyleSheet.absoluteFill');
  });
});

describe('the week\'s carousel says the rating and nothing else', () => {
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));
  const featured = home.slice(
    home.indexOf('function FeaturedCard('),
    home.indexOf('const RAIL_AVATAR'),
  );

  it('reduces the featured chip to the star and the number', () => {
    /*
     * "Top rated" repeated the section header immediately above the carousel, on
     * every card (Amit). With the words gone there is no fallback worth drawing,
     * so a provider with no ratings gets no pill at all rather than a solid
     * accent pill asserting nothing.
     */
    expect(featured).not.toContain('Top rated');
    expect(featured).toContain('{provider.rating_count > 0 ? (');
    expect(featured).toContain('accessible={false}');
  });

  it('still announces what the number means', () => {
    // The chip is accessible={false} like every MetaChip, so "★ 4.8" is never
    // spoken as glyphs; the card's own label carries it in the directory's words.
    // https://developer.android.com/guide/topics/ui/accessibility/principles
    expect(featured).toContain('from ${provider.rating_count} reviews');
    expect(featured).toContain("'no reviews yet'");
    expect(featured).toContain('accessibilityLabel={accessibility}');
  });

  it('puts that pill on the accent step that can carry text', () => {
    // 12dp Bold white on bg/accent measured 3.44:1 light and 2.59:1 dark against
    // Android's 4.5:1 floor for text under 18sp. design/tokens.json already said
    // bg/accent "must NEVER sit under small white text".
    const badge = home.slice(
      home.indexOf('featuredBadge: {'),
      home.indexOf('featuredBadgeText: {'),
    );
    expect(badge).toContain('t.color.bg.accentStrong');
    expect(badge).not.toContain('t.color.bg.accent,');
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.onAccent, DARK.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('a section header is not a second title', () => {
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));

  it('separates the pair by size, weight AND ink', () => {
    /*
     * Both lines were Geist-Bold in text/primary and differed only in size, so
     * they read as two titles arguing rather than a title and its section. The
     * reference steps all three at once: 14dp + AndroidUtilities.bold() in a grey
     * that is never the title's ink (GraySectionCell.java:57-59,
     * HeaderCell.java:94-95) under a 20dp black ActionBar title
     * (ActionBar.java:1455). bold() is weight 500, not 700
     * (AndroidUtilities.java:263-272), which is what makes this titleSmall.
     */
    const picks = home.slice(home.indexOf('picksTitle: {'), home.indexOf('picksBelow: {'));
    expect(picks).toContain('TOKENS.typography.titleSmall');
    expect(picks).toContain('t.color.text.section');
    expect(picks).not.toContain('titleMediumEmphasized');
    const explore = home.slice(
      home.indexOf('exploreTitle: {'),
      home.indexOf('featuredCard: {'),
    );
    expect(explore).toContain('TOKENS.typography.headlineSmallEmphasized');
    expect(explore).toContain('t.color.text.primary');
    // Read as VALUES, so this cannot be satisfied by any source text at all:
    // the two roles can never collapse onto one weight, size or ink.
    expect(TOKENS.typography.titleSmall.fontFamily).not.toBe(
      TOKENS.typography.headlineSmallEmphasized.fontFamily,
    );
    expect(TOKENS.typography.titleSmall.fontSize).toBeLessThan(
      TOKENS.typography.headlineSmallEmphasized.fontSize,
    );
    expect(LIGHT.color.text.section).not.toBe(LIGHT.color.text.primary);
    expect(DARK.color.text.section).not.toBe(DARK.color.text.primary);
  });

  it('marks Home\'s three headings as headings', () => {
    // TalkBack can then jump between them instead of walking every row, which is
    // what the reference gets from ViewCompat.setAccessibilityHeading on the same
    // two cells (GraySectionCell.java:76, HeaderCell.java:107).
    // https://reactnative.dev/docs/accessibility
    expect(home.match(/accessibilityRole="header"/g)?.length).toBe(3);
  });

  it('holds AA for the ink the picks header actually uses, in both modes', () => {
    /*
     * The reference's own key_graySectionText is #82878A in the day theme
     * (ThemeColors.java:138) and measures 3.63:1 on white — below AA for a 14dp
     * Medium header, which is NOT WCAG large text (>=18.66px bold / >=24px) and
     * which Android's own page puts at 4.5:1. The palette's hue is taken and the
     * value darkened by the smallest uniform step that passes, rather than the
     * gate being lowered. scripts/check-contrast.mjs does not yet carry these
     * three pairs (that file was outside this change set's ownership), so this
     * is the gate that holds them.
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     *
     * BOUND TO THE CONSUMER, not to the palette. This used to read generated
     * colour values only, so it measured `text.section` whether or not any
     * header used it — it would have stayed green with `picksTitle` reverted to
     * `text.primary`. The role is now parsed OUT of `picksTitle`, so the gate
     * fails both if Home stops using it and if the palette drifts under it.
     */
    const picks = home.slice(home.indexOf('picksTitle: {'), home.indexOf('picksBelow: {'));
    const role = /color: t\.color\.text\.(\w+)/.exec(picks)?.[1];
    expect(role).toBe('section');
    for (const mode of [LIGHT, DARK]) {
      for (const bg of [mode.color.bg.base, mode.color.bg.raised, mode.color.bg.grouped]) {
        expect(contrast(mode.color.text.section, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
    // And it is genuinely quieter than the title it sits under, or it buys
    // nothing: the point is a step DOWN in ink, not a second black line.
    expect(contrast(LIGHT.color.text.section, LIGHT.color.bg.base)).toBeLessThan(
      contrast(LIGHT.color.text.primary, LIGHT.color.bg.base),
    );
    expect(contrast(DARK.color.text.section, DARK.color.bg.base)).toBeLessThan(
      contrast(DARK.color.text.primary, DARK.color.bg.base),
    );
  });
});
