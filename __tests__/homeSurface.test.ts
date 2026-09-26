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

describe('the search field is the one the reference app actually ships', () => {
  const bar = withoutComments(read('src/components/SearchBar.tsx'));
  const styles = bar.slice(bar.indexOf('container: {'));

  it('is a 40dp pill inside a 48dp row, not an M3 56dp bar', () => {
    /*
     * Everything this component used to be was measured off the M3 docked search
     * bar (56dp, radius 28) and everything the MOTION was measured off came from
     * ActionBar/ActionBarMenuItem.java — the reference app's LEGACY action-bar search,
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
     * the reference app's 24dp `createFrame`. Those are not the same kind of thing. The
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
     * Our glyph also inks a fraction of its em rather than filling it (the
     * ICON_SCALE docblock in Icon.tsx explains why), so our ink is
     * `round(size * ICON_SCALE) * emUnits / 24`. At the old size 20 the
     * magnifier drew 19.97dp against 13.94 — 43% oversized, on the one control
     * Amit named.
     *
     * WHAT IS AND IS NOT VERIFIED MECHANICALLY HERE. `ICON_SCALE` is parsed out
     * of Icon.tsx, so a change to it fails this. The reference's ink is
     * RECOMPUTED from the drawable's own four numbers rather than being asserted
     * as a constant. The two glyph extents are values recorded here from a
     * fontTools BoundsPen over assets/fonts/Phosphor.ttf (`magnifying-glass`
     * 19.99 and `x` 15.36 of 24 em units, after the generator's 250-unit
     * EM_WINDOW; the glyf header's xMin/yMin are zeroed by svg2ttf and must not
     * be used) — Jest has no TTF outline parser, so those two are not
     * re-measured, and that is stated rather than implied. They were Lucide's
     * 19.97 and 13.97 until 2026-09-26; the cross is a bigger drawing in
     * Phosphor, which is why CLEAR_GLYPH_SIZE moved and SEARCH_GLYPH_SIZE did not.
     */
    const ICON_SCALE = Number(
      /const ICON_SCALE = ([\d.]+)/.exec(read('src/components/Icon.tsx'))?.[1],
    );
    expect(ICON_SCALE).toBe(1.2);
    /** Extents below are in 24ths of the em, the unit the scale was set in. */
    const EM_UNITS = 24;
    const inkOf = (size: number, emUnits: number): number =>
      (Math.round(size * ICON_SCALE) * emUnits) / EM_UNITS;

    const searchSize = Number(
      /const SEARCH_GLYPH_SIZE = (\d+)/.exec(bar)?.[1],
    );
    const clearSize = Number(/const CLEAR_GLYPH_SIZE = (\d+)/.exec(bar)?.[1]);

    const referenceSearchInk = ((57.525 - 15.7) / 72) * 24;
    expect(referenceSearchInk).toBeGreaterThan(13.9);
    expect(referenceSearchInk).toBeLessThan(14);
    // Within half a dp of the reference's mark, which is the closest any step of
    // `size` can land: 15 would give 14.98 and 13 would give 12.98.
    expect(Math.abs(inkOf(searchSize, 19.99) - referenceSearchInk)).toBeLessThan(
      0.5,
    );
    // The clear cross, inside the range the reference's own density buckets
    // disagree over rather than at one end of it.
    expect(inkOf(clearSize, 15.36)).toBeGreaterThanOrEqual(11);
    expect(inkOf(clearSize, 15.36)).toBeLessThanOrEqual(12);
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
     * pair travels together — which is what the chat composer already does for
     * the message field, and this gate holds both so one cannot be removed
     * alone. There the `includeFontPadding: false` half arrives with the
     * typography token the field spreads, so it is asserted on the token.
     */
    const input = styles.slice(styles.indexOf('input: {'));
    expect(input).toContain("textAlignVertical: 'center'");
    expect(input).toContain('includeFontPadding: false');

    const composer = withoutComments(read('src/chat-v2/ChatComposerV2.tsx'));
    const field = composer.slice(composer.indexOf('input: {'));
    expect(field).toContain("textAlignVertical: 'center'");
    expect(field).toContain('...TOKENS.typography.bodyMedium');
    expect(TOKENS.typography.bodyMedium.includeFontPadding).toBe(false);
  });

  it('holds the text inset constant while you type, the way FragmentSearchField does', () => {
    /*
     * The defect a member can feel. The clear button used to be conditionally
     * MOUNTED (`value.length > 0 ? <Pressable size={36}> : null`), so the input's
     * right inset flipped between 16dp and 64dp and the caret jumped sideways on
     * the first keystroke and again on clear. the reference app recomputes `pEnd` as
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
     * right edge like the reference app"). The reference supports exactly this —
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
     * The duration is a token, so "make search calmer" stays one edit. The
     * bezier used to be rebuilt locally from motion.m3.easing.easeOutQuint,
     * "because src/theme/motion.ts keeps its own copy module-private" — that
     * reason expired on 2026-09-12, when the audit behind DESIGN.md's
     * art-direction rule 2 ("a curve is never defaulted and never hand-typed")
     * exported `EASE_OUT_QUINT` from motion.ts. Two identical curves derived
     * from the same four numbers is the drift that rule exists to stop, so the
     * local copy is gone and this asserts the import instead.
     */
    expect(TOKENS.motion.duration.clearReveal).toBe(380);
    expect(TOKENS.motion.m3.easing.easeOutQuint).toEqual([0.23, 1, 0.32, 1]);
    expect(bar).toContain('TOKENS.motion.duration.clearReveal');
    expect(bar).toContain('EASE_OUT_QUINT');
    expect(bar).toMatch(/import\s*\{[^}]*EASE_OUT_QUINT[^}]*\}\s*from\s*'\.\.\/theme\/motion'/);
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
     * the reference app composites the fill out of the text ink —
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
    expect(header).toContain('Departs from the reference app, on purpose:');
    const departures = header.slice(header.indexOf('Departs from the reference app'));
    expect(departures).toContain('THE PILL FILL IS A SOLID TOKEN');
    expect(departures).toContain('FragmentSearchField.java:275');
    expect(departures).toContain('check-contrast.mjs');
    // The ripple is the second undeclared departure the audit found; it is
    // the reference app's own createSelectorDrawable, but at our radius token, not dp(17).
    expect(bar).toContain('highlight="ripple"');
    expect(departures).toContain('FragmentSearchField.java:278');
  });
});

describe('search MOVES the way the reference app moves it, not only measures like it', () => {
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
    /*
     * 2026-09-08: this row moved out of HomeScreen into `TabTopBar`, the one
     * component Home, Favourites and Settings all render, so the bar cannot
     * drift between tabs (Amit: "home to fovourties o setting the top app bar
     * remians constant"). The assertions are unchanged — only the file they
     * read is.
     */
    const bar = withoutComments(read('src/components/TabTopBar.tsx'));
    /*
     * `entering={enter}` / `exiting={exit}`, not the animations by name: the
     * first render passes neither, because a subtree that mounts inside
     * `TabLayer`'s `display: 'none'` never runs its entering animation and
     * would stay at FadeIn's opacity 0 forever (device-found on Favourites —
     * see the comment on `mounted` in TabTopBar.tsx). Every render after the
     * first uses `searchIn` / `searchOut`, which is when the crossfade is
     * wanted, and that binding is what these two lines pin.
     */
    expect(bar).toContain('entering={enter}');
    expect(bar).toContain('exiting={exit}');
    expect(bar).toContain('const enter = mounted.current ? searchIn : undefined');
    expect(bar).toContain('const exit = mounted.current ? searchOut : undefined');
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

  /*
   * Android's floor, quoted so the number in these tests is never a preference:
   * "we recommend that each interactive UI element have a focusable area, or
   * touch target size, of at least 48dp x 48dp. Larger is even better."
   * https://developer.android.com/guide/topics/ui/accessibility/apps
   *
   * NOT taken from the the reference app Mini Apps UI kit, which was mined as a reference
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
      /const TAB_INDICATOR_SLOT = (\d+)/.exec(tabsSource)?.[1],
    );
    // The 2dp line Bluesky draws sits inside that 3dp slot.
    expect(Number(/const TAB_INDICATOR_HEIGHT = (\d+)/.exec(tabsSource)?.[1])).toBe(2);
    const labelPadBottom = Number(
      /const TAB_LABEL_PAD_BOTTOM = (\d+)/.exec(tabsSource)?.[1],
    );
    // ADR-0033: Bluesky's pager tab (TabBar.tsx:477-492) is paddingTop 10 +
    // a 20 line + paddingBottom 10 + a 3dp indicator slot. In the kept 48dp box,
    // bottom-anchored, that leaves 15 above the label: 15 + 20 + 10 + 3 = 48.
    expect(labelPadBottom).toBe(10);
    expect(TOKENS.typography.textMdSemiBold.lineHeight).toBe(20);
    const content =
      TOKENS.typography.textMdSemiBold.lineHeight + labelPadBottom + indicatorHeight;
    expect(content).toBeLessThan(TOKENS.interaction.minTarget);
    expect(TOKENS.interaction.minTarget - content).toBe(15);
    // Content alone is under 48, so the box must state its own height rather
    // than lean on slop (the original defect).

    const tab = tabsSource.slice(tabsSource.indexOf('    tab: {'), tabsSource.indexOf('    tabLabel: {'));
    expect(tab).toContain('minHeight: TOKENS.interaction.minTarget');
    // Bottom edge, where TabLayout draws its own indicator. Centring it would
    // meet the target and still leave the underline floating mid-box.
    expect(tab).toContain("justifyContent: 'flex-end'");
    // The indicator's slot plus Bluesky's label padding, as padding, so the
    // shared animated indicator draws in the space below the label.
    expect(tab).toContain(
      'paddingBottom: TAB_INDICATOR_SLOT + TAB_LABEL_PAD_BOTTOM',
    );
    // The label is Bluesky's text_md SemiBold.
    const label = tabsSource.slice(tabsSource.indexOf('    tabLabel: {'), tabsSource.indexOf('    tabLabelOn: {'));
    expect(label).toContain('...TOKENS.typography.textMdSemiBold');
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
    /*
     * 2026-09-08: this row moved out of HomeScreen into `TabTopBar`, the one
     * component Home, Favourites and Settings all render, so the bar cannot
     * drift between tabs (Amit: "home to fovourties o setting the top app bar
     * remians constant"). The assertions are unchanged — only the file they
     * read is.
     */
    const bar = withoutComments(read('src/components/TabTopBar.tsx'));
    const navIcon = bar.slice(bar.indexOf('    navIcon: {'), bar.indexOf('    navRow: {'));
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
    expect(bar.match(/size=\{TOKENS\.interaction\.minTarget\}/g)?.length).toBe(1);
    expect(bar).not.toContain('size={28}');
    // And the bar reaches a target by laying out a box, never by hanging slop
    // off one, which is the rule SearchBar.tsx states for itself.
    expect(bar).not.toContain('hitSlop');
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

  it('has ONE indicator that the pager moves, not one per tab that switches colour', () => {
    /*
     * Still one absolutely-positioned bar for the whole strip, never a static
     * style swap per tab (the original defect was a state change expressed as a
     * style swap). What moves it CHANGED on 2026-09-27 (owner decision, Amit:
     * Bluesky's pager mechanics exactly): it was a timed tween toward the tapped
     * index with TabLayout's elastic edges; it is now Bluesky's TabBar
     * `indicatorStyle`, a full-width view whose `translateX` and `scaleX` are
     * interpolated from the pager's drag progress.
     *
     * REPINNED, and why each old pin went: `transform: [{ translateX: left }]`
     * and `width: Math.max(right - left, 0)` described the lerped-edges
     * indicator; `not.toContain('right:')` asserted the old `left`+`width`
     * geometry. Bluesky's bar spans the strip (`left: 0, right: 0`) and is
     * scaled, never resized, so no frame of a drag runs layout. It is square,
     * so `scaleX` has no radius to smear (animate-expo's reason to prefer
     * `width` for a pill does not apply).
     */
    expect(home).not.toContain('tabRule');
    expect(home).not.toContain('tabRuleOn');
    expect(home).toContain('style={[styles.tabIndicator, tabIndicatorStyle]}');
    expect(home).toContain('const tabIndicatorStyle = useAnimatedStyle(');
    expect(home.match(/styles\.tabIndicator\b/g)?.length).toBe(1);
    const indicator = home.slice(home.indexOf('    tabIndicator: {'), home.length);
    expect(indicator).toContain("position: 'absolute'");
    expect(indicator).toContain('left: 0');
    expect(indicator).toContain('right: 0');
    expect(indicator).toContain('bottom: 0');
    const style = home.slice(
      home.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      home.indexOf('  return (', home.indexOf('const tabIndicatorStyle = useAnimatedStyle(')),
    );
    expect(style).toMatch(
      /translateX: interpolate\(p, TAB_INDICES, centres, Extrapolation\.CLAMP\)/,
    );
    expect(style).toMatch(/scaleX: interpolate\(p, TAB_INDICES, scales, Extrapolation\.CLAMP\)/);
    // No animated layout property on the bar.
    expect(style).not.toMatch(/\bwidth:|\bleft:|\bmarginLeft:/);
  });

  it('sizes the indicator to the LABEL, floored at Bluesky\'s 45', () => {
    /*
     * M3 PRIMARY tabs size the indicator to the label (`tabIndicatorFullWidth`
     * false in `Base.Widget.Material3.TabLayout`), and so does Bluesky: its
     * `getScaleX` is `min(max(minIndicatorWidth, textWidth), maxIndicatorWidth)
     * / contentSize` with `minIndicatorWidth = 45` (TabBar.tsx). Here the cap is
     * the tab's half of the strip, and the divisor is the strip width because
     * the bar spans it. The tab stays full width; the indicator does not.
     */
    expect(home).toContain('const TAB_INDICATOR_MIN_WIDTH = 45');
    expect(Number(/const TAB_INDICATOR_MIN_WIDTH = (\d+)/.exec(home)?.[1])).toBe(45);
    const style = home.slice(
      home.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      home.length,
    );
    expect(style).toContain('tabLabelWidths.get()');
    expect(style).toContain(
      'Math.min(Math.max(widths[i] ?? 0, TAB_INDICATOR_MIN_WIDTH), slot) / width',
    );
    // The centre of each tab, relative to the full-width bar's own centre.
    expect(style).toContain('(i + 0.5) * slot - width / 2');
    // The labels and the strip are measured — without this the indicator
    // would be stuck on the seeds.
    expect(home).toContain('onLabelLayout(index, e.nativeEvent.layout.width)');
    expect(home).toContain('onTabStripLayout(e.nativeEvent.layout.width)');

    // 2dp and square (Bluesky's `borderBottomWidth: 2`, ADR-0033), inside the
    // 3dp slot the label padding reserves.
    expect(Number(/const TAB_INDICATOR_HEIGHT = (\d+)/.exec(home)?.[1])).toBe(2);
    const indicator = home.slice(home.indexOf('    tabIndicator: {'), home.length);
    expect(indicator).toContain('height: TAB_INDICATOR_HEIGHT');
    expect(indicator).not.toMatch(/Radius/);
  });

  it('has no timing of its own: the page scroll is the only clock', () => {
    /*
     * REPLACES "takes the timing from tokens and the shape from the elastic
     * interpolator". That test pinned a 500ms `withTiming` (M3
     * `motionDurationLong2`) on M3 standard easing and the sine lead/trail of
     * `ElasticTabIndicatorInterpolator` — correct for a TAPPED TabLayout with
     * nothing under it to follow, and the old motion.ts note itself named the
     * exception: with a pager, TabLayout drives the indicator "from the pager's
     * own offset instead" (`setIndicatorPositionFromTabPosition`). A tap now
     * calls `ViewPager2.setCurrentItem(item, true)` and the indicator follows
     * that scroll. A second, separately-timed tween would lag or lead the page.
     *
     * So the tokens and helpers are gone, and must stay gone: a timer in this
     * strip would be exactly that second clock.
     */
    expect(motion).not.toContain('export const TAB_INDICATOR');
    expect(motion).not.toContain('tabIndicatorTo');
    expect(motion).not.toContain('tabIndicatorLead');
    expect(motion).not.toContain('tabIndicatorTrail');
    expect(home).not.toMatch(/withTiming|withSpring|withDelay|duration:|easing:/);
    expect(home).not.toMatch(/\buseEffect\b/);
  });

  it('crossfades the two registered inks on the drag, never dims the secondary one', () => {
    /*
     * Bluesky interpolates each label's OPACITY over [index - 1, index,
     * index + 1] (0.7 / 1 / 0.7). Amit's inks are text.secondary inactive and
     * text.primary active (2026-09-26). text.secondary at 0.7 measures under
     * 4.5:1 in both themes (asserted as values below), so the drag is carried
     * as a crossfade of the two registered inks on Bluesky's input range:
     * a text.primary copy over the text.secondary label, opacities 0/1/0 and
     * 1/0/1. Opacity, because it is Reanimated's synchronous UI-prop path and
     * text `color` is not.
     */
    const label = home.slice(home.indexOf('function TabLabel('), home.indexOf('const makeStyles'));
    expect(label.match(/\[index - 1, index, index \+ 1\]/g)?.length).toBe(2);
    expect(label).toContain('[0, 1, 0]');
    expect(label).toContain('[1, 0, 1]');
    expect(label).toMatch(/progress\.get\(\)/);
    expect(label).not.toMatch(/interpolateColor|color:/);
    // The overlay is decoration for TalkBack, which reads the Pressable's label.
    expect(label).toContain('importantForAccessibility="no"');
    expect(label).toContain('styles.tabLabelOn, styles.tabLabelLayer');

    const mix = (fg: string, bg: string, a: number): string =>
      '#' +
      [1, 3, 5]
        .map(i =>
          Math.round(
            parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a),
          )
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    for (const theme of [LIGHT, DARK]) {
      const { primary, secondary } = theme.color.text;
      const base = theme.color.bg.base;
      // Why Bluesky's literal 0.7 on top of the secondary ink was rejected.
      expect(contrast(mix(secondary, base, 0.7), base)).toBeLessThan(4.5);
      // And the crossfade clears the floor on every frame of a drag.
      for (let step = 0; step <= 20; step++) {
        const a = step / 20;
        const composite = mix(primary, mix(secondary, base, 1 - a), a);
        expect(contrast(composite, base)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the category tabs sit on a native pager, driven on the UI thread', () => {
  /*
   * Owner decision (Amit, 2026-09-26/27): switching Listeners / Astrologers
   * follows Bluesky's mechanics exactly — a horizontal pager you can swipe, the
   * tab indicator tracking the drag in real time, a tapped tab animating the
   * page, the label ink following the drag. Bluesky's Pager.tsx is
   * react-native-pager-view (androidx.viewpager2) with a Reanimated worklet on
   * its page events.
   */
  const pager = withoutComments(read('src/components/ProviderPager.tsx'));
  const tabs = withoutComments(read('src/components/ProviderTypeTabs.tsx'));
  const home = withoutComments(read('src/screens/HomeScreen.tsx'));
  const favourites = withoutComments(read('src/screens/FavouritesScreen.tsx'));
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };

  it('is react-native-pager-view, pinned to the version Bluesky runs', () => {
    // Exact, not a range: 8.x/9.x swap ViewPager2 for a Compose pager.
    expect(pkg.dependencies['react-native-pager-view']).toBe('6.8.0');
    expect(pager).toContain("import PagerView, { type PagerViewProps } from 'react-native-pager-view'");
    expect(pager).toContain('Animated.createAnimatedComponent(PagerView)');
    expect(pager).toContain('offscreenPageLimit={1}');
  });

  it('is the pager on both screens that carry the tabs', () => {
    for (const screen of [home, favourites]) {
      expect(screen).toContain('<ProviderPager\n');
      expect(screen).toContain('dragProgress={categoryProgress}');
      expect(screen).toContain('progress={categoryProgress}');
      expect(screen).toContain('onSelect={selectCategory}');
      expect(screen).toContain('PROVIDER_CATEGORIES.map(');
    }
    // One list per page, each with its own testID.
    expect(home).toContain('testID={`home-scroll-${category}`}');
    expect(favourites).toContain('testID={`favourites-scroll-${category}`}');
    // Search is its own surface: the pager lives in the directory layer only.
    const directoryLayer = home.slice(home.indexOf('key="directory"'), home.indexOf('</ProviderPager>'));
    expect(directoryLayer).toContain('<ProviderPager\n');
    const searchLayer = home.slice(home.indexOf('key="search-results"'), home.indexOf('key="directory"'));
    expect(searchLayer).not.toContain('ProviderPager');
  });

  it('writes the drag progress on the UI thread, from position + offset', () => {
    const worklet = pager.slice(pager.indexOf('useEvent<PagerEvent>('), pager.indexOf("['onPageScroll', 'onPageSelected']"));
    expect(worklet).toContain("'worklet'");
    expect(worklet).toContain("event.eventName.endsWith('onPageScroll')");
    expect(worklet).toContain('dragProgress.set((event.offset ?? 0) + (event.position ?? 0))');
  });

  it('reads that progress in the indicator and labels, and only in worklets', () => {
    const indicator = tabs.slice(
      tabs.indexOf('const tabIndicatorStyle = useAnimatedStyle('),
      tabs.indexOf('  return (', tabs.indexOf('const tabIndicatorStyle = useAnimatedStyle(')),
    );
    expect(indicator).toContain('const p = progress.get()');
    // Every read of `progress` is inside a `useAnimatedStyle`.
    const reads = tabs.match(/progress\.get\(\)/g)?.length ?? 0;
    expect(reads).toBe(3);
    expect(tabs.match(/useAnimatedStyle\(/g)?.length).toBe(3);
  });

  it('crosses to the JS thread once per page change, never per scroll frame', () => {
    const worklet = pager.slice(pager.indexOf('useEvent<PagerEvent>('), pager.indexOf("['onPageScroll', 'onPageSelected']"));
    const scrollBranch = worklet.slice(
      worklet.indexOf("endsWith('onPageScroll')"),
      worklet.indexOf("endsWith('onPageSelected')"),
    );
    const selectedBranch = worklet.slice(worklet.indexOf("endsWith('onPageSelected')"));
    expect(scrollBranch).not.toContain('scheduleOnRN');
    expect(selectedBranch).toContain('scheduleOnRN(notifySelected');
    expect(pager.match(/scheduleOnRN\(/g)?.length).toBe(1);
    // Built once; the JS callback behind it is a stable identity.
    expect(pager).not.toMatch(/useEvent<PagerEvent>\([\s\S]*?\],\s*true\s*\)/);
    // No React state in the strip or the pager, and no JS scroll handler.
    for (const source of [tabs, pager]) {
      expect(source).not.toMatch(/useState|setState/);
    }
    for (const screen of [home, favourites]) {
      expect(screen).not.toMatch(/onPageScroll=/);
    }
  });

  it('taps the pager rather than the category, and jumps under reduced motion', () => {
    // Bluesky's onTabBarSelect → pagerView.setPage(index).
    expect(home).toContain('pagerRef.current.setPage(index)');
    expect(favourites).toContain('pagerRef.current?.setPage(PROVIDER_CATEGORIES.indexOf(c))');
    // ViewPager2.setCurrentItem(item, false) under "Remove animations".
    expect(pager).toContain('const reducedMotion = useReducedMotion()');
    expect(pager).toMatch(
      /if \(reducedMotion\) \{\s*pagerView\.current\?\.setPageWithoutAnimation\(index\);\s*\} else \{\s*pagerView\.current\?\.setPage\(index\);/,
    );
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

  it('carries experience inline with the rating, at the bottom of the card', () => {
    /*
     * Amit, 2026-09-08: "carousle cards should laos have experience and ratings
     * inline -- place them smartly and space efficiently".
     *
     * NARROWED 2026-09-26 for the 150dp portrait card (Amit: "name + F-28 and
     * rating at the bottom"). The line used to carry reviews, years and
     * languages, ~250dp of text; the card has 126dp inside its padding with the
     * rating pill on the same row, so the years are what is drawn beside it and
     * the review count is spoken (the label still says "from N reviews").
     */
    expect(featured).toContain('heroMeta');
    expect(featured).toContain('seededExperienceYears(provider.id)');
    expect(featured).not.toMatch(/<MetaChip[^>]*tone="onMedia"/);
    expect(featured).toMatch(/numberOfLines=\{1\}[\s\S]{0,80}featuredMeta/);
    // The pill and the years share ONE row, under the name, at the bottom.
    const body = featured.slice(featured.indexOf('styles.featuredBody'));
    const row = body.slice(body.indexOf('styles.featuredMetaRow'));
    expect(body.indexOf('styles.featuredName')).toBeLessThan(body.indexOf('styles.featuredMetaRow'));
    expect(row).toContain('styles.featuredBadge');
    expect(row).toContain('{heroMeta}');
    expect(home.slice(home.indexOf('featuredBadge: {'), home.indexOf('featuredBadgeText: {'))).not.toContain(
      "position: 'absolute'",
    );
    // The tagline is spoken, no longer drawn: ~18 characters fit at 126dp.
    expect(featured).not.toContain('styles.featuredTagline');
    expect(featured).toContain('tagline,');
  });

  it('is a portrait 3:4 card the photo fills, so the selfie shows whole', () => {
    // Amit, 2026-09-26: the landscape hero cropped faces. 087 stores avatars at
    // 3:4, so a 150x200 request is a resize and the photo fills the frame.
    expect(featured).toContain('HERO_CARD_HEIGHT,');
    const photo = home.slice(home.indexOf('featuredPhoto: {'), home.indexOf('featuredScrim: {'));
    expect(photo).toContain('bottom: 0');
    expect(photo).not.toContain('aspectRatio');
    expect(home).not.toContain('HERO_PHOTO_HEIGHT_RATIO');
    const card = home.slice(home.indexOf('featuredCard: {'), home.indexOf('featured: {'));
    expect(card).toContain('width: HERO_CARD_WIDTH');
    expect(card).toContain('height: HERO_CARD_HEIGHT');
    // The skeleton draws the same cards, so nothing jumps when the data lands.
    const skeleton = withoutComments(read('src/components/DirectorySkeleton.tsx'));
    expect(skeleton).toContain('width={HERO_CARD_WIDTH}');
    expect(skeleton).toContain('height={HERO_CARD_HEIGHT}');
    expect(skeleton).toContain('gap: HERO_CARD_GAP');
    expect(skeleton).not.toContain('height={190}');
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
     * (AndroidUtilities.java:263-272). ADR-0033 keeps the three-axis step but
     * takes the roles from Bluesky: ModuleHeader TitleText (text_lg SemiBold)
     * over SubtitleText (text_sm leading_tight, Regular).
     */
    const picks = home.slice(home.indexOf('picksTitle: {'), home.indexOf('picksBelow: {'));
    expect(picks).toContain('TOKENS.typography.textSmTight');
    expect(picks).toContain('t.color.text.section');
    expect(picks).not.toContain('titleMediumEmphasized');
    const explore = home.slice(
      home.indexOf('exploreTitle: {'),
      home.indexOf('featuredCard: {'),
    );
    expect(explore).toContain('TOKENS.typography.textLgSemiBold');
    expect(explore).toContain('t.color.text.primary');
    // Read as VALUES, so this cannot be satisfied by any source text at all:
    // the two roles can never collapse onto one weight, size or ink.
    expect(TOKENS.typography.textSmTight.fontFamily).not.toBe(
      TOKENS.typography.textLgSemiBold.fontFamily,
    );
    expect(TOKENS.typography.textSmTight.fontSize).toBeLessThan(
      TOKENS.typography.textLgSemiBold.fontSize,
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

  it('sets Chats and Explore as Bluesky section headers, at the tabs\' scale', () => {
    // ADR-0033 (Amit, 2026-09-26): "Chats"/"Explore" at Bold 24/32 dwarfed the
    // Listeners/Astrologers tabs above them. Both are ModuleHeader TitleText now,
    // text_lg SemiBold, a step above the tabs' text_md rather than a display size.
    const rail = home.slice(home.indexOf('railLabel: {'), home.indexOf('seeAll: {'));
    expect(rail).toContain('...TOKENS.typography.textLgSemiBold');
    expect(TOKENS.typography.textLgSemiBold.fontSize).toBeGreaterThan(
      TOKENS.typography.textMdSemiBold.fontSize,
    );
    // ModuleHeader Container spacing: pt_2xl 24 (tabs' marginBottom sm + sm),
    // pb_md 12, and 24 above Explore.
    const header = home.slice(home.indexOf('railHeader: {'), home.indexOf('railEmpty: {'));
    expect(header).toContain('paddingTop: TOKENS.space.sm');
    expect(header).toContain('paddingBottom: TOKENS.space.sm');
    const explore = home.slice(home.indexOf('exploreHead: {'), home.indexOf('picksHead: {'));
    expect(explore).toContain('paddingTop: TOKENS.space.xl');
  });

  it('gives "See all" a 48dp target that bleeds, so the Chats row height does not depend on it', () => {
    // "See all" renders only when there are chats. A 48dp box that set the row
    // height would make Explore sit lower on Listeners than on Astrologers.
    expect(home).toMatch(
      /const SEE_ALL_BLEED =\s*\(TOKENS\.interaction\.minTarget - TOKENS\.typography\.textLgSemiBold\.lineHeight\) \/ 2;/,
    );
    const seeAll = home.slice(home.indexOf('    seeAll: {'), home.indexOf('seeAllText: {'));
    expect(seeAll).toContain('minHeight: TOKENS.interaction.minTarget');
    // On a wrapper View, never on the Pressable: Pressable keeps margins on
    // its inner view and moves minHeight to its root, so a bleed there leaves
    // the row 48 tall (measured on the S22, 2026-09-26).
    expect(seeAll).not.toMatch(/margin/);
    const bleed = home.slice(home.indexOf('    seeAllBleed: {'), home.indexOf('    seeAll: {'));
    expect(bleed).toContain('marginVertical: -SEE_ALL_BLEED');
    expect(home).toMatch(/<View style=\{styles\.seeAllBleed\}>\s*<Pressable[\s\S]*?testID="chats-see-all"/);
    expect((TOKENS.interaction.minTarget - TOKENS.typography.textLgSemiBold.lineHeight) / 2).toBe(13);
    const seeAllText = home.slice(home.indexOf('seeAllText: {'), home.indexOf('railScroll: {'));
    expect(seeAllText).toContain('...TOKENS.typography.textSmSemiBold');
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

/*
 * The Chats rail is a horizontal ScrollView, which clips its children on
 * Android, and Badge draws its pill above its anchor. An anchor that does not
 * make up that overhang puts the top of every unread count outside the
 * scroller, where it is cut off (2026-09-26, on the S22).
 */
describe('Chats rail unread badge', () => {
  it('is anchored low enough that the whole pill sits inside the scroller', () => {
    const badge = read('src/components/Badge.tsx');
    const home = read('src/screens/HomeScreen.tsx');
    const overhang = Number(/pill:\s*\{[^}]*?top:\s*(-?\d+)/.exec(badge)?.[1]);
    const anchorTop = Number(/railBadge:\s*\{[^}]*?top:\s*(-?\d+)/.exec(home)?.[1]);
    expect(Number.isFinite(overhang)).toBe(true);
    expect(Number.isFinite(anchorTop)).toBe(true);
    expect(anchorTop + overhang).toBeGreaterThanOrEqual(0);
  });
});

/*
 * ADR-0033 (Amit, 2026-09-26: "match chips to bluesky"). Bluesky's selectable
 * pill (src/components/InterestTabs.tsx:359-381) marks selection with fill,
 * border and ink, never the brand colour, and the callers pass `selected`
 * rather than a coral tone.
 */
describe('selectable chips are Bluesky pills', () => {
  const chip = read('src/components/Chip.tsx');
  const block = (name: string) =>
    chip.slice(chip.indexOf(`  ${name}: {`), chip.indexOf('},', chip.indexOf(`  ${name}: {`)));

  it('draws the pill and its selected state without the accent', () => {
    expect(block('chip')).toContain('borderWidth: 1');
    expect(block('chip')).toContain('paddingHorizontal: TOKENS.space.md');
    expect(block('chip')).toContain('paddingVertical: TOKENS.space.xs');
    expect(block('label')).toContain('...TOKENS.typography.textSmSemiBold');
    for (const name of ['chip', 'chipSelected', 'label', 'labelSelected']) {
      expect(block(name)).not.toMatch(/accent|inverse/);
    }
  });

  it('is selected by state, not painted warm, on Home and the application', () => {
    for (const file of ['src/screens/HomeScreen.tsx', 'src/screens/ProviderApplicationScreen.tsx']) {
      expect(read(file)).not.toMatch(/tone=\{[^}]*'warm'/);
    }
  });
});
