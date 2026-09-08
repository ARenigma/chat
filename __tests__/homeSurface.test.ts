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
    /*
     * Not `export const`: neither name ever had a consumer outside this file, and
     * an unread export reads as the app's declared geometry to whoever greps for
     * it next — the same failure that got `layout.searchBar` deleted from
     * design/tokens.json. The VALUES are still pinned here; only their reach
     * changed, and the `not.toContain('export const SEARCH_')` below is what stops
     * them drifting back out without a consumer arriving with them.
     */
    /*
     * The 40 is now DERIVED from the reference's one `setPadding` call rather
     * than written out, so it is read here as arithmetic on values: 48 minus 4
     * top and bottom. `setPadding(dp(4), dp(4), dp(4), dp(4))` is a single call
     * with a single number in it, and splitting it into a vertical constant and
     * a horizontal one is what let the horizontal half get dropped.
     */
    expect(bar).toContain('const SEARCH_ROW_HEIGHT = 48');
    expect(bar).toContain('const PILL_INSET = 4');
    expect(bar).toContain(
      'const SEARCH_PILL_HEIGHT = SEARCH_ROW_HEIGHT - PILL_INSET * 2',
    );
    const row = Number(/const SEARCH_ROW_HEIGHT = (\d+)/.exec(bar)?.[1]);
    const pillInset = Number(/const PILL_INSET = (\d+)/.exec(bar)?.[1]);
    expect(row).toBe(48);
    expect(row - pillInset * 2).toBe(40);
    expect(bar).not.toContain('export const SEARCH_');
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

  it('insets the pill 4dp on ALL FOUR sides, the two that were dropped included', () => {
    /*
     * THE DEFECT THIS GATE HOLDS, and it is a retraction rather than a new
     * finding. Until 2026-09-07 this file inset the pill 4dp top and bottom and
     * NOTHING left or right, on the recorded argument that "the horizontal half
     * exists only so `setupBlurredBackground` has 4dp to bleed into". The source
     * says the opposite. `dispatchDraw` bounds the pill drawable to the padding
     * box on every side —
     *
     *   bg.setBounds(getPaddingLeft(), getPaddingTop(),
     *                getWidth() - getPaddingRight(),
     *                getHeight() - getPaddingBottom())
     *
     * FragmentSearchField.java:187-193 — while the BLUR is given bounds expanded
     * back OUT by dp(4) on each side (`:196-200`) so that, with its own
     * `setPadding(dp(4))` (`:209`), it lands on the same rect the pill does. The
     * padding shapes the pill; the blur cancels the padding. Cost of the
     * misreading: a pill 8dp wider than the reference's with both glyphs 4dp too
     * far out — which is what "icon placement is still not exactly the same"
     * describes.
     *
     * Asserted per edge rather than as one string, because the shape of the bug
     * was two edges present and two edges missing.
     */
    const pill = styles.slice(
      styles.indexOf('pill: {'),
      styles.indexOf('glyphSlot: {'),
    );
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      expect(pill).toContain(`${edge}: PILL_INSET`);
    }
    // The flush-to-the-edge form cannot come back looking correct.
    expect(pill).not.toMatch(/left: 0\b/);
    expect(pill).not.toMatch(/right: 0\b/);

    /*
     * And the inset is SPENT ON THE SLOTS, not on the container, so the text
     * inset stays at the reference's 48dp measured from the PILL — every one of
     * its numbers is measured from the padding box, because a FrameLayout lays
     * its children out inside the parent's padding and `checkUi_editTextPaddings`
     * (`:239-254`) then sets the EditText's own 48dp on top of that.
     *
     *   4 + 48 = 52 to the text, 4 + 12 = 16 to the glyph frame
     *
     * Read as arithmetic on the file's own values so it cannot be satisfied by
     * any comment: 4 + 48 has to come out at 52 and 4 + 12 at 16.
     */
    const pillInset = Number(/const PILL_INSET = (\d+)/.exec(bar)?.[1]);
    const glyphInset = Number(/const GLYPH_INSET = (\d+)/.exec(bar)?.[1]);
    const glyphBox = Number(/const GLYPH_BOX = (\d+)/.exec(bar)?.[1]);
    expect(pillInset + glyphInset * 2 + glyphBox).toBe(52);
    expect(pillInset + glyphInset).toBe(16);
    const leading = styles.slice(
      styles.indexOf('glyphSlot: {'),
      styles.indexOf('clearSlot: {'),
    );
    const trailing = styles.slice(
      styles.indexOf('clearSlot: {'),
      styles.indexOf('clearTarget: {'),
    );
    /*
     * A 48dp box on a 4dp MARGIN, not a 52dp box with 4dp of padding. Both give
     * the same two insets, and only the margin keeps the box's centre on the
     * glyph's centre — which is the pivot `clearStyle` scales and rotates about,
     * and the reference transforms the 24dp `closeIcon` view itself
     * (FragmentFloatingButton.java:250-258), whose pivot IS the mark. Padding
     * would put the pivot 2dp off and drift the glyph ~1dp sideways through the
     * 380ms reveal.
     */
    expect(leading).toContain('width: GLYPH_SLOT');
    expect(leading).toContain('marginLeft: PILL_INSET');
    expect(trailing).toContain('width: GLYPH_SLOT');
    expect(trailing).toContain('marginRight: PILL_INSET');
    // Outer side only, and no padding: either would move the glyph off the
    // slot's centre, which is the whole reason it is a margin.
    expect(leading).not.toContain('marginRight');
    expect(trailing).not.toContain('marginLeft');
    expect(leading).not.toContain('padding');
    expect(trailing).not.toContain('padding');
  });

  it('sizes both glyphs to the reference INK, not to the reference FRAME', () => {
    /*
     * THE SECOND RETRACTION. This file used to say "size=20 because Icon.tsx
     * renders at round(size * 1.2), so 20 -> a 24dp box", matching our em box to
     * Telegram's 24dp `createFrame`. Those are not the same kind of thing. The
     * reference's 24dp is where the mark is PUT — `createFrame(24, 24, ..., 12,
     * 0, 12, 0)` at FragmentSearchField.java:132 and :159 — and both its marks
     * are drawn at `ImageView.ScaleType.CENTER` (`:130`, `:139`), which never
     * scales a drawable, so the mark is its own intrinsic size and much smaller
     * than the frame:
     *
     *   search  res/drawable/outline_search_1_24.xml, 24dp wide on a 72-unit
     *           viewport, fill path spanning x 15.700..57.525
     *           -> 41.825 / 72 * 24 = 13.94dp
     *   close   res/drawable-*\/miniplayer_close.webp, intrinsic 12x14dp at every
     *           bucket; alpha bounding box 12x12dp at mdpi, 11x11dp at xhdpi and
     *           xxhdpi -> 11-12dp
     *
     * A Lucide glyph also inks a fraction of its em rather than filling it (the
     * ICON_SCALE docblock in Icon.tsx measures the set and explains why), so our
     * ink is `round(size * ICON_SCALE) * gridUnits / 24`. At the old size 20 the
     * magnifier drew 19.97dp against 13.94 — 43% oversized, on the one control
     * Amit named.
     *
     * WHAT IS AND IS NOT VERIFIED MECHANICALLY HERE. `ICON_SCALE` is parsed out
     * of Icon.tsx, so a change to it fails this. The reference's ink is
     * RECOMPUTED from the drawable's own four numbers rather than being asserted
     * as a constant. The two Lucide grid extents are values recorded here from a
     * fontTools outline-bounds pen over assets/fonts/Lucide.ttf (uniE151 =
     * `search`, uniE1B2 = `close`; the glyf header's xMin/yMin are zeroed by
     * lucide-static and must not be used, which is the trap Icon.tsx's header
     * documents) — Jest has no TTF outline parser, so those two are not
     * re-measured, and that is stated rather than implied.
     */
    const ICON_SCALE = Number(
      /const ICON_SCALE = ([\d.]+)/.exec(read('src/components/Icon.tsx'))?.[1],
    );
    expect(ICON_SCALE).toBe(1.2);
    /** Lucide draws on a 24x24 grid and the font maps it onto the em 1:1. */
    const LUCIDE_GRID = 24;
    const inkOf = (size: number, gridUnits: number): number =>
      (Math.round(size * ICON_SCALE) * gridUnits) / LUCIDE_GRID;

    const searchSize = Number(
      /const SEARCH_GLYPH_SIZE = (\d+)/.exec(bar)?.[1],
    );
    const clearSize = Number(/const CLEAR_GLYPH_SIZE = (\d+)/.exec(bar)?.[1]);

    const referenceSearchInk = ((57.525 - 15.7) / 72) * 24;
    expect(referenceSearchInk).toBeGreaterThan(13.9);
    expect(referenceSearchInk).toBeLessThan(14);
    // Within half a dp of the reference's mark, which is the closest any step of
    // `size` can land: 15 would give 14.98 and 13 would give 12.98.
    expect(Math.abs(inkOf(searchSize, 19.97) - referenceSearchInk)).toBeLessThan(
      0.5,
    );
    // The clear cross, inside the range the reference's own density buckets
    // disagree over rather than at one end of it.
    expect(inkOf(clearSize, 13.97)).toBeGreaterThanOrEqual(11);
    expect(inkOf(clearSize, 13.97)).toBeLessThanOrEqual(12);
    // And the oversized value cannot come back at either call site.
    expect(bar).toContain('size={SEARCH_GLYPH_SIZE}');
    expect(bar).toContain('size={CLEAR_GLYPH_SIZE}');
    expect(bar).not.toMatch(/name="search"\s*\n?\s*size=\{20\}/);
    expect(bar).not.toContain('size={20}');
  });

  it('centres the input in the row the way the doc pairs the two props', () => {
    /*
     * The reference sets the gravity explicitly: `editText.setGravity((isRTL ?
     * Gravity.RIGHT : Gravity.LEFT) | Gravity.CENTER_VERTICAL)`
     * (FragmentSearchField.java:107). Here it was left to `textAlignVertical`'s
     * default of `'auto'`
     * (https://reactnative.dev/docs/text-style-props#textalignvertical), which
     * resolves to `Gravity.NO_GRAVITY` and therefore to whatever gravity the
     * theme's `editTextStyle` constructed the EditText with
     * (ReactEditText.kt:188-193 sets `defaultGravityVertical` in `init`, and the
     * `gravityVertical` setter falls back to it when the value is 0) — an
     * inherited default rather than a decision.
     *
     * `includeFontPadding: false` is on the SAME doc page's own instruction, not
     * as a second opinion: "With some fonts, this padding can make text look
     * slightly misaligned when centered vertically. For best results also set
     * textAlignVertical to center." This field renders a custom face, so the
     * pair travels together — which is what Composer.tsx already does for the
     * message field, and this gate holds both so one cannot be removed alone.
     */
    const input = styles.slice(styles.indexOf('input: {'));
    expect(input).toContain("textAlignVertical: 'center'");
    expect(input).toContain('includeFontPadding: false');
    expect(withoutComments(read('src/components/Composer.tsx'))).toContain(
      'includeFontPadding: false',
    );
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
    /*
     * The condition gained a second term on 2026-09-07: the trailing mark is
     * now the EXIT as well as the clear, so it must be visible in the state
     * where there is nothing to clear (Amit: "Please bring exit back in search
     * right edge like telegram"). The reference supports exactly this —
     * visibility is `closeButtonForcedVisible || editText.length() > 0`
     * (FragmentSearchField.java:326) with a public setter at `:321`.
     *
     * What this test is FOR is unchanged and is the line below: the slot is
     * always LAID OUT, so the text inset never moves while you type. Only its
     * opacity, scale and rotation animate.
     */
    expect(bar).toContain(
      'const clearTarget = hasQuery || onExit !== undefined ? 1 : 0',
    );
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
    /*
     * The animated wrapper and the Pressable inside it are BOTH declared at the
     * 48dp slot, which is the point — the wrapper cannot shrink the Pressable
     * and the Pressable cannot outgrow the wrapper. The pill's 4dp sits on the
     * wrapper as a margin, outside both boxes, so it takes nothing off the
     * target.
     */
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
    // The glyph it animates is the clear cross, at the size the ink-parity gate
    // above derives. It used to be asserted here as `size={20}`, matching our em
    // box to the reference's positioning FRAME; that gate is retired and the
    // arithmetic one replaces it.
    expect(bar).toContain('name="close"');
    expect(bar).toContain('size={CLEAR_GLYPH_SIZE}');
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
     * FlashList gives its own ROOT view `flex: 1` whenever the list is vertical
     * — `flex: horizontal ? undefined : 1` on the outer `CompatView`,
     * @shopify/flash-list@2.3.2 src/recyclerview/RecyclerView.tsx:537 (compiled
     * to dist/recyclerview/RecyclerView.js:340) — and a Reanimated `exiting`
     * animation keeps the leaving view in the layout tree until it finishes. As
     * plain flex siblings the outgoing and incoming lists would each take HALF
     * the column for the whole 200ms, so the swap would read as a squash rather
     * than a dissolve. The reference stacks them too: `searchViewPager` and
     * `viewPages[0]` are siblings in one FrameLayout.
     *
     * This comment used to cite a bare "RecyclerView.js:340" with no path, which
     * a reader cannot resolve — there is no RecyclerView.js at the package root
     * — and which described the SCROLL VIEW rather than the wrapper the flex
     * actually sits on. The claim held; the pointer did not.
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

describe('a citation resolves to what the comment claims', () => {
  /*
   * The premise of this whole change set is that a wrong pointer is worse than
   * no pointer, because a reader checks it and is misled. Two of the three the
   * audit found are in files this suite already covers, and each gets the
   * strongest gate its source admits.
   */

  it('checks the flash-list line against the installed package, not against itself', () => {
    /*
     * The stacking comment justifies itself with FlashList's own `flex: 1`. It
     * used to cite "@shopify/flash-list RecyclerView.js:340" — no path, and
     * there is no RecyclerView.js at the package root, so nobody could resolve
     * it. The claim was true; it lives on the outer `CompatView` in
     * src/recyclerview/RecyclerView.tsx, compiled to
     * dist/recyclerview/RecyclerView.js:340.
     *
     * So the line number is PARSED OUT of the comment and checked against the
     * installed source. That makes this a real gate rather than the repo
     * grepping its own documentation: it goes red if the citation is wrong, and
     * it goes red if a flash-list upgrade moves the line — which is precisely
     * when the citation would have gone stale without anyone noticing.
     */
    const home = read('src/screens/HomeScreen.tsx');
    expect(home).not.toContain('(@shopify/flash-list RecyclerView.js:340)');
    const cited = /src\/recyclerview\/RecyclerView\.tsx:(\d+)/.exec(home)?.[1];
    expect(cited).toBeDefined();
    const source = read(
      'node_modules/@shopify/flash-list/src/recyclerview/RecyclerView.tsx',
    ).split('\n');
    expect(source[Number(cited) - 1]).toContain('flex: horizontal ? undefined : 1');
  });

  it('retires the wrong DialogsActivity line for the 1.05 away scale', () => {
    /*
     * `:7602-7603` is inside `searchAnimator`'s `onAnimationEnd` listener — a
     * closing brace and `setDialogsListFrozen(false)` — and sets no scale at
     * all. The 1.05 pair is at `:7573-7574`, guarded by `if (!budget)` at
     * `:7572`, with the pager initialised to the same value at `:13284-13285`.
     * Read against the 12.10.1 (7038) tree, clone 62b56a07.
     *
     * A `not.toContain` on the KNOWN-WRONG string, deliberately. The reference
     * tree is not in this repo, so nothing here can verify the right line the
     * way the flash-list gate above does; and a gate that grepped for the RIGHT
     * string would be matching this repo's own documentation, which is the false
     * gate this file's header exists to warn about. Forbidding the retired
     * pointer cannot pass by accident, and it is what stops a revert.
     *
     * Matched WITH the file prefix, `DialogsActivity.java:7602-7603`, which is
     * the citation FORM the reverted comment carries. The correction note in
     * motion.ts names the retired number in prose as a bare `:7602-7603` so the
     * history stays readable without tripping its own gate.
     */
    const raw = read('src/theme/motion.ts');
    expect(raw).not.toContain('DialogsActivity.java:7602-7603');
    expect(raw).toContain('DialogsActivity.java:7573-7574');
  });
});

describe('every control on Home is a real 48dp box, not slop a parent clips', () => {
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));

  /*
   * Android's floor, quoted so the number in these tests is never a preference:
   * "we recommend that each interactive UI element have a focusable area, or
   * touch target size, of at least 48dp x 48dp. Larger is even better."
   * https://developer.android.com/guide/topics/ui/accessibility/apps
   *
   * NOT taken from the Telegram Mini Apps UI kit, which was mined as a reference
   * while this was being written and which cannot support a claim about Android
   * sizes at all: EVERY control it ships is under 48 (icon buttons 32/40/44, the
   * segmented track 44, the small button 38) and its "Android" icon-button set is
   * dimensionally identical to its iOS set, so the kit carries no Android
   * provenance for dimensions and must not be cited to excuse a sub-48 target.
   */
  it('starts from the platform minimum, as a value', () => {
    expect(TOKENS.interaction.minTarget).toBe(48);
  });

  it('gives each Explore tab a 48dp box with the indicator on its bottom edge', () => {
    /*
     * Reads `ProviderTypeTabs.tsx` for this one `it`, unlike its neighbours in
     * this describe block, because the tab strip moved there on 2026-09-08 and
     * this file's own `home` binding still (correctly) means HomeScreen.tsx for
     * every other assertion around it — so this local is named `tabsSource`
     * rather than shadowing it.
     */
    const tabsSource = withoutComments(read('src/components/ProviderTypeTabs.tsx'));
    /*
     * The defect: `tab` declared no height, so the box was its content — the
     * label's 24dp lineHeight + a 4dp gap + the 2dp rule = 30dp — and the
     * `Pressable` around it passed no `size`, taking Pressable's sizeless
     * default of `ceil(minTarget / 6)` slop (Pressable.tsx:231-234). The
     * arithmetic below is spelled out as VALUES rather than asserted as source
     * text, so this cannot be satisfied by a comment and cannot silently pass if
     * the type scale moves: 30 + 8 + 8 = 46, two dp short even before the
     * clipping, and "The touch area never extends past the parent view bounds"
     * (https://reactnative.dev/docs/view#hitslop) took more of it off the top
     * because the strip's own box was only 30 + 12 tall.
     *
     * 48 is also Material's own text-only tab height — `DEFAULT_HEIGHT = 48` in
     * material-components-android lib/java/com/google/android/material/tabs/
     * TabLayout.java, against DEFAULT_HEIGHT_WITH_TEXT_ICON = 72 — so the fix is
     * the component's spec height, not an accessibility patch on a smaller one.
     * (Read from the Material source: m3.material.io is client-rendered and
     * returns nothing but a title to a fetch.)
     */
    const indicatorHeight = Number(
      /const TAB_INDICATOR_HEIGHT = (\d+)/.exec(tabsSource)?.[1],
    );
    const content =
      TOKENS.typography.titleMediumEmphasized.lineHeight +
      TOKENS.space['2xs'] +
      indicatorHeight;
    const sizelessSlop = Math.ceil(TOKENS.interaction.minTarget / 6);
    expect(content).toBeLessThan(TOKENS.interaction.minTarget);
    expect(content + sizelessSlop * 2).toBeLessThan(TOKENS.interaction.minTarget);

    const tab = tabsSource.slice(tabsSource.indexOf('    tab: {'), tabsSource.indexOf('    tabLabel: {'));
    expect(tab).toContain('minHeight: TOKENS.interaction.minTarget');
    // Bottom edge, where TabLayout draws its own indicator. Centring it would
    // meet the target and still leave the underline floating mid-box.
    expect(tab).toContain("justifyContent: 'flex-end'");
    // The label sits exactly where the removed per-tab rule left it: the space
    // that rule and its gap occupied is now padding, so nothing about the
    // 48dp box or the label's baseline moved when the indicator became one
    // shared, animated view.
    expect(tab).toContain(
      "paddingBottom: TAB_INDICATOR_HEIGHT + TOKENS.space['2xs']",
    );
  });

  it('gives the button that opens search a 48dp box', () => {
    /*
     * Both nav controls share `styles.navIcon`, and it was `width: 28, height:
     * 40` with `size={28}` on the Pressable, i.e. `max(8, ceil((48 - 28) / 2))
     * = 10` of hitSlop (Pressable.tsx:231-234) hung on a content-sized parent.
     * The search glyph is the FIRST child of `navTrailing`, whose left edge IS
     * the glyph box's left edge, so that side is clipped to nothing —
     * https://reactnative.dev/docs/view#hitslop. Exactly the defect the search
     * field's clear control had, and it takes the same fix: a laid-out
     * `interaction.minTarget` box, declared on the style AND on the Pressable so
     * neither can shrink the other.
     */
    const navIcon = home.slice(home.indexOf('    navIcon: {'), home.indexOf('    scroll: {'));
    expect(navIcon).toContain('width: TOKENS.interaction.minTarget');
    expect(navIcon).toContain('height: TOKENS.interaction.minTarget');
    // No raw box left behind for the token to shadow.
    expect(navIcon).not.toMatch(/width: \d/);
    expect(navIcon).not.toMatch(/height: \d/);
    // Both Pressables that wear it ask for that same 48, so the style and the
    // component agree instead of one of them quietly deciding — and the 28 they
    // used to pass cannot creep back under a 48dp style and look correct.
    /*
     * ONE, not two. The "leave search" arrow is gone as of 2026-09-07: the
     * reference's field is MATCH_PARENT with 7dp side margins
     * (DialogsActivity.java:5344) and has no sibling, so an arrow in the row was
     * what stopped our bar reaching both edges and pushed the magnifier ~70dp
     * in. Leaving search is the hardware back button, wired and device-verified
     * the same day (HomeScreen's `searchBackGuard`).
     */
    expect(home.match(/size=\{TOKENS\.interaction\.minTarget\}/g)?.length).toBe(1);
    expect(home).not.toContain('size={28}');
    // And Home reaches a target by laying out a box, never by hanging slop off
    // one, which is the rule SearchBar.tsx states for itself.
    expect(home).not.toContain('hitSlop');
  });
});

describe('the type tabs are a Material tab row, division and indicator both', () => {
  /*
   * REPOINTED 2026-09-08: this suite used to read HomeScreen.tsx directly. The
   * whole tab strip — hooks, JSX and styles — was extracted verbatim into
   * `ProviderTypeTabs.tsx` so Favourites could carry the same tabs (Amit:
   * "favourites should also have type tabs at top") without a second hand-built
   * copy of an elastic M3 indicator. Every assertion below is unchanged; only
   * the file it reads from moved, which is exactly what should happen when code
   * moves without changing behaviour.
   */
  const home = withoutComments(read('src/components/ProviderTypeTabs.tsx'));
  const motion = withoutComments(read('src/theme/motion.ts'));

  it('divides the whole strip between the tabs, which is the TabLayout default', () => {
    /*
     * "Type tab should take full width" (Amit) — and it is not a preference, it
     * is the component's default behaviour, which this strip was not following.
     * `TabLayout` defaults `mode` to `MODE_FIXED` and `tabGravity` to
     * `GRAVITY_FILL` (material-components-android
     * lib/java/com/google/android/material/tabs/TabLayout.java:674-675), and
     * under that pair `updateTabViewLayoutParams` sets every tab to
     * `lp.width = 0; lp.weight = 1` (:1797-1805) — LinearLayout's "share the
     * parent equally", which is `flex: 1` here. `MODE_FIXED` is documented on
     * the same class as "Fixed tabs display all tabs concurrently" (:1124).
     *
     * The strip was `paddingHorizontal: md` + `gap: lg` with content-sized tabs,
     * so on a 360dp window roughly 160dp of the row was reachable by nothing.
     * Both must stay gone: either one takes width away from the share each tab
     * is entitled to, and `MODE_FIXED` explicitly zeroes the strip's own start
     * padding (`slidingTabIndicator.setPaddingRelative(paddingStart, 0, 0, 0)`
     * with `paddingStart` computed only for the scrollable modes, :2085-2091).
     */
    const tabs = home.slice(
      home.indexOf('    tabs: {'),
      home.indexOf('    tab: {'),
    );
    expect(tabs).toContain("flexDirection: 'row'");
    expect(tabs).not.toContain('paddingHorizontal');
    expect(tabs).not.toContain('gap:');
    const tab = home.slice(home.indexOf('    tab: {'), home.indexOf('    tabLabel: {'));
    expect(tab).toContain('flex: 1');
    // `marginBottom`, not `paddingBottom`: the indicator is an absolute child at
    // `bottom: 0`, and whether Yoga measures that from the padding edge or the
    // border edge is not something the indicator's position should depend on.
    expect(tabs).toContain('marginBottom: TOKENS.space.sm');
    expect(tabs).not.toContain('paddingBottom');
  });

  it('has ONE indicator that moves, not one per tab that switches colour', () => {
    /*
     * The answer to "is this standard animation?" is yes, and the class that
     * does it is called `SlidingTabIndicator`. `animateIndicatorToPosition`
     * (TabLayout.java:3334) — "Animate the position of the indicator from its
     * current position to a new position. This is typically used when a tab
     * destination is tapped." — runs a `ValueAnimator` (:3379-3386) and feeds
     * every frame to `TabIndicatorInterpolator.updateIndicatorForOffset`, which
     * LERPS THE LEFT AND RIGHT BOUNDS INDEPENDENTLY between the two tabs
     * (TabIndicatorInterpolator.java). Position and width both animate.
     *
     * So: the two static styles are gone, and what replaced them is one
     * absolutely-positioned Animated.View whose width and translateX come from a
     * worklet. Asserted as the ABSENCE of the switch and the PRESENCE of the
     * animated style, because the defect was that a state change was expressed
     * as a style swap.
     */
    expect(home).not.toContain('tabRule');
    expect(home).not.toContain('tabRuleOn');
    expect(home).toContain('style={[styles.tabIndicator, tabIndicatorStyle]}');
    expect(home).toContain('const tabIndicatorStyle = useAnimatedStyle(');
    // Exactly one indicator view in the strip, whatever the tab count.
    expect(home.match(/styles\.tabIndicator/g)?.length).toBe(1);
    const indicator = home.slice(
      home.indexOf('    tabIndicator: {'),
      home.length,
    );
    expect(indicator).toContain("position: 'absolute'");
    expect(indicator).toContain('left: 0');
    expect(indicator).toContain('bottom: 0');
    // The offset rides on a transform, not on an animated `left`, so a tab
    // change does not re-run layout for every frame of the move.
    const style = home.slice(
      home.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      home.length,
    );
    expect(style).toContain('transform: [{ translateX: left }]');
    expect(indicator).not.toContain('right:');
  });

  it('sizes the indicator to the LABEL, which is the M3 PRIMARY tab rule', () => {
    /*
     * The one place the two M3 tab flavours disagree, and the source settles it:
     * `Base.Widget.Material3.TabLayout` (primary) sets
     * `<item name="tabIndicatorFullWidth">false</item>` while
     * `Base.Widget.Material3.TabLayout.Secondary` sets it `true`
     * (material-components-android
     * lib/java/com/google/android/material/tabs/res/values/styles.xml). With it
     * false, `calculateIndicatorWidthForTab` returns
     * `calculateTabViewContentBounds(tab, MIN_INDICATOR_WIDTH)` — the LABEL's
     * bounds, floored at 24dp — rather than the tab's own left/right
     * (TabIndicatorInterpolator.java).
     *
     * This strip is primary tabs (title-weight labels, no icons, documented as
     * such at the call site), so THE TAB IS FULL WIDTH AND THE INDICATOR IS NOT.
     * They are two separate settings in the reference and conflating them is the
     * easy mistake here — it would have been one line shorter to stretch the bar
     * across each half.
     *
     * The floor is read as a value, so it cannot drift away from the
     * reference's 24 without failing.
     */
    expect(home).toContain('const TAB_INDICATOR_MIN_WIDTH = 24');
    expect(Number(/const TAB_INDICATOR_MIN_WIDTH = (\d+)/.exec(home)?.[1])).toBe(24);
    const style = home.slice(
      home.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      home.length,
    );
    // The label's measured width, floored, is what sets the bar's edges.
    expect(style).toContain('tabLabelWidths.value');
    expect(style).toContain(
      'Math.max(widths[index] ?? 0, TAB_INDICATOR_MIN_WIDTH)',
    );
    // And the width is animated rather than being a constant dash: the two
    // labels differ ("Listeners" against "Astrologers"), so even a rigid move
    // has to resize.
    expect(style).toContain('width: Math.max(right - left, 0)');
    // The labels are measured — without this the indicator would silently be
    // the 24dp floor forever.
    expect(home).toContain('onTabLabelLayout(index, e.nativeEvent.layout.width)');
    expect(home).toContain('onTabStripLayout(e.nativeEvent.layout.width)');

    /*
     * 3dp tall with the top corners rounded and the bottom square, which is the
     * primary indicator's own drawable: `m3_tabs_rounded_line_indicator` is a
     * rectangle with topLeft/topRight 3dp and bottomLeft/bottomRight 0dp, sized
     * to `m3_comp_primary_navigation_tab_active_indicator_height` = 3dp
     * (the tabs component's res/drawable and res/values/tokens.xml). It was a
     * 2dp bar rounded on all four corners; the bottom radius rounded against an
     * edge nothing can see.
     */
    expect(Number(/const TAB_INDICATOR_HEIGHT = (\d+)/.exec(home)?.[1])).toBe(3);
    const indicator = home.slice(
      home.indexOf('    tabIndicator: {'),
      home.length,
    );
    expect(indicator).toContain('height: TAB_INDICATOR_HEIGHT');
    expect(indicator).toContain('borderTopLeftRadius: TAB_INDICATOR_HEIGHT');
    expect(indicator).toContain('borderTopRightRadius: TAB_INDICATOR_HEIGHT');
    expect(indicator).not.toMatch(/borderRadius:/);
    expect(indicator).not.toMatch(/borderBottom\w*Radius/);
  });

  it('takes the timing from tokens and the shape from the elastic interpolator', () => {
    /*
     * Duration: `Base.Widget.Material3.TabLayout` sets
     * `<item name="tabIndicatorAnimationDuration">?attr/motionDurationLong2</item>`
     * (the tabs component's res/values/styles.xml), `motionDurationLong2` maps to
     * `@integer/m3_sys_motion_duration_long2` (theme/res/values/themes_base.xml)
     * and that integer is 500 (motion/res/values/tokens.xml). `M3.duration.long2`
     * is 500 — asserted as a value, so this is not the repo grepping its own
     * comment, and it is the first consumer of a token the map had reserved.
     *
     * Shape: the same style asks for
     * `<item name="tabIndicatorAnimationMode">elastic</item>`, and
     * `ElasticTabIndicatorInterpolator` gives the two edges different easings so
     * the bar stretches across the gap and gathers in on arrival —
     * `decInterp` = `Math.sin((fraction * Math.PI) / 2.0)` for the edge being
     * travelled toward, `accInterp` = `1.0 - Math.cos((fraction * Math.PI) /
     * 2.0)` for the edge being left. Both are exact here; a sine did not have to
     * be approximated into a bezier. The functions are asserted as CODE, not as
     * a claim about code, because getting the two the wrong way round inverts the
     * stretch into a squash and no still frame would show it.
     *
     * Easing: the reference's TIME curve is `motionEasingEmphasizedInterpolator`
     * (TabLayout.java:663-665), and M3's `emphasized` is a two-segment PATH —
     * `path(M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1
     * 1,1)` — not a single cubic bezier, so `Easing.bezier` cannot express it and
     * design/tokens.json carries only its decelerate and accelerate halves.
     * `M3.easing.standard`, cubic-bezier(0.2, 0, 0, 1), is the closest exact M3
     * token the map holds. That is a stated departure, and this gate pins it so a
     * later pass that adds a real `emphasized` token has to come back here.
     */
    expect(TOKENS.motion.m3.duration.long2).toBe(500);
    expect(TOKENS.motion.m3.easing.standard).toEqual([0.2, 0, 0, 1]);
    const tabs = motion.slice(motion.indexOf('export const TAB_INDICATOR'));
    expect(tabs).toMatch(
      /TAB_INDICATOR = \{\s*duration: M3\.duration\.long2,\s*easing: M3_STANDARD,\s*reduceMotion: ReduceMotion\.System,/,
    );
    expect(motion).toMatch(
      /const M3_STANDARD = Easing\.bezier\(\s*M3\.easing\.standard\[0\]/,
    );
    expect(tabs).toContain('return withTiming(index, TAB_INDICATOR)');
    expect(tabs).toMatch(
      /export function tabIndicatorLead[\s\S]*?return Math\.sin\(\(fraction \* Math\.PI\) \/ 2\);/,
    );
    expect(tabs).toMatch(
      /export function tabIndicatorTrail[\s\S]*?return 1 - Math\.cos\(\(fraction \* Math\.PI\) \/ 2\);/,
    );
    // The leading edge is the one being travelled toward, in BOTH directions.
    const style = home.slice(
      home.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      home.length,
    );
    expect(style).toContain('const movingRight = to.left > from.left');
    expect(style).toMatch(
      /leftFraction = movingRight\s*\?\s*tabIndicatorTrail\(fraction\)\s*:\s*tabIndicatorLead\(fraction\)/,
    );
    expect(style).toMatch(
      /rightFraction = movingRight\s*\?\s*tabIndicatorLead\(fraction\)\s*:\s*tabIndicatorTrail\(fraction\)/,
    );
    // No hand-written duration or curve at the call site: HomeScreen holds the
    // geometry, motion.ts holds every number that is about time.
    expect(style).not.toMatch(/duration:|easing:|withTiming|withSpring/);
    expect(home).toContain('tabSlide.value = tabIndicatorTo(tabIndex)');
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
    expect(featured).toContain('accessible={false}');
    /*
     * UNCONDITIONAL since 2026-09-08, where this asserted
     * `provider.rating_count > 0 ? (` — a real change, not a loosening.
     *
     * The old rule was that an unrated provider gets no pill, because a pill
     * asserting nothing on a "Top profiles this week" card is an advert rather
     * than a status. That was right while the number could be absent. It no
     * longer can: `displayRating` always returns one, so the hero hiding its
     * pill made it the ONE surface still saying nothing for a provider whose
     * card below showed four and a half stars — and where both were visible
     * they could disagree, because this read `rating_avg` directly instead of
     * going through the same function.
     */
    expect(featured).not.toContain('provider.rating_count > 0');
    expect(featured).toContain('rating.score.toFixed(1)');
    expect(featured).toContain('displayRating(provider)');
  });

  it('carries experience and reviews inline, without growing the card', () => {
    /*
     * Amit, 2026-09-08: "carousle cards should laos have experience and ratings
     * inline -- place them smartly and space efficiently".
     *
     * One text line REPLACING the two language chips, not a third row added
     * under them. The chips cost 32dp of a 210dp card to say two words; the
     * dot-separated line carries reviews, experience AND languages in 16dp. The
     * card did not get taller, which is where the "space efficiently" is.
     */
    expect(featured).toContain('heroMeta');
    expect(featured).toContain('formatReviewCount(rating.count)');
    expect(featured).toContain('seededExperienceYears(provider.id)');
    expect(featured).not.toMatch(/<MetaChip[^>]*tone="onMedia"/);
    expect(featured).toMatch(/numberOfLines=\{1\}[\s\S]{0,80}featuredMeta/);
  });

  it('still announces what the number means', () => {
    // The chip is accessible={false} like every MetaChip, so "★ 4.8" is never
    // spoken as glyphs; the card's own label carries it in the directory's words.
    // https://developer.android.com/guide/topics/ui/accessibility/principles
    // Through `rating` now, so the spoken number is the same one the pill
    // shows — including when it is a system rating.
    expect(featured).toContain('from ${rating.count} reviews');
    /*
     * The experience is spoken too, and pluralised — `${years} ${years === 1 ?
     * 'year' : 'years'} experience`, so a one-year provider is not announced as
     * "1 years".
     */
    expect(featured).toContain("'year' : 'years'} experience");
    /*
     * "no reviews yet" is GONE from this card, and that is the point of the
     * change above: `displayRating` always returns a count, so there is no
     * unrated branch left to speak. A provider with no genuine reviews is
     * announced with the system number the pill is showing, which is at least
     * consistent with what a sighted user sees.
     */
    expect(featured).not.toContain("'no reviews yet'");
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
