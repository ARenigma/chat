/**
 * The search field, measured off the reference app's CURRENT one.
 *
 * This file used to be built to `m3.material.io/components/search/specs` (56dp
 * pill, radius 28, carried as `layout.searchBar` = 56 in design/tokens.json,
 * now deleted from the token map because nothing read it). That was a
 * deliberate, recorded decision; it is being reversed on the owner's explicit
 * instruction that search should look and move like the reference app's, so the table
 * below is the reference app's MEASUREMENTS and every place this file does something
 * else is named in the departures list under it. Nothing in the table is a
 * claim about what this file does — the departures are.
 *
 * Harvested per ADR-0025: MEASUREMENTS and TIMINGS are facts and are recorded
 * with a `File.java:line` citation; no source, string or asset is copied.
 * Reference is the 12.10.1 (7038) tree, clone `62b56a07`, confirmed upstream
 * HEAD on 2026-09-07. `AndroidUtilities.dp()` is `(int) Math.ceil(density *
 * value)` with no font scaling (`AndroidUtilities.java:2702-2707`), so every
 * the reference app dp maps 1:1 onto a React Native dp and nothing needs converting.
 *
 * IMPORTANT correction to what this repo believed: the numbers previously in
 * here and in `src/theme/motion.ts` were measured off
 * `ActionBar/ActionBarMenuItem.java`, which is the reference app's LEGACY action-bar
 * search — a 36dp-tall bare `EditTextBoldCursor` with `setBackgroundResource(0)`,
 * i.e. no pill at all. The dialogs list has not used that path for several
 * versions. The field it actually ships is
 * `Components/FragmentSearchField.java`, built at `DialogsActivity.java:3285`
 * and added to the content view at `:5344`.
 *
 *   Row height            48dp   DialogsActivity.java:295 (SEARCH_FIELD_HEIGHT), :5344
 *   Row inset, screen edge 7dp   DialogsActivity.java:5344, createFrame(MATCH_PARENT,
 *                                48, Gravity.TOP, 7, -2, 7, 0)
 *   Pill inset, ALL FOUR   4dp   DialogsActivity.java:3294 setPadding(dp(4) x4),
 *                                and the pill is drawn INSIDE it — see below
 *   Pill height           40dp   48 - 4 - 4
 *   Pill radius           20dp   FragmentSearchField.java:275 createRoundRectDrawable(dp(20))
 *   Pill fill             on-surface ink at 5% light / 7% dark, same line
 *   Glyph FRAMES        24x24dp  FragmentSearchField.java:132 (search), :159 (clear)
 *   Glyph frame inset     12dp   the same two createFrame calls, measured from the
 *                                PADDING box, so 16dp from the view's own edge
 *   Search glyph INK    13.94dp  res/drawable/outline_search_1_24.xml is 24dp wide on a
 *                                72-unit viewport and its fill path spans x
 *                                15.700..57.525 -> 41.825/72 * 24dp. Drawn at
 *                                ScaleType.CENTER (:130), which never scales.
 *   Clear glyph INK  11 - 12dp   res/drawable-*\/miniplayer_close.webp, intrinsic 12x14dp
 *                                at every density bucket; alpha bounding box 12x12dp at
 *                                mdpi and 11x11dp at xhdpi/xxhdpi. ScaleType.CENTER
 *                                again (:139), so 24dp is the frame and never the mark.
 *   Text inset both ends  48dp   FragmentSearchField.java:104, recomputed at :240-242,
 *                                also measured from the PADDING box
 *   Clear reveal    380ms EASE_OUT_QUINT, alpha 0->1, scale 0.4->1, rotate 90->0
 *                          FragmentSearchField.java:57, :330-333;
 *                          FragmentFloatingButton.java:250-258 for the scale ramp
 *   Clear press feedback   a circular ripple, radius 17dp
 *                          FragmentSearchField.java:278
 *                          createSelectorDrawable(key_listSelector, 1, dp(17))
 *
 * TWO NUMBERS IN THE PREVIOUS VERSION OF THIS TABLE WERE WRONG, and they are
 * called out rather than quietly replaced, because both were argued for in
 * writing and a reader who trusted the argument deserves to see it retracted.
 *
 * 1. "The pill is flush with this component's left and right edges... the
 *    horizontal half [of the 4dp padding] exists only so `setupBlurredBackground`
 *    has 4dp to bleed into." That is backwards. `dispatchDraw` bounds the pill
 *    drawable to the PADDING BOX on all four sides —
 *    `bg.setBounds(getPaddingLeft(), getPaddingTop(), getWidth() -
 *    getPaddingRight(), getHeight() - getPaddingBottom())`
 *    (`FragmentSearchField.java:187-193`) — so the horizontal 4dp shortens the
 *    PILL, exactly as the vertical 4dp shortens it to 40dp. The blur is the thing
 *    that ignores the padding: it is given bounds expanded back OUT by dp(4) on
 *    every side (`:196-200`) precisely so that, with its own `setPadding(dp(4))`
 *    (`:209`), it lands back on the same rect as the pill. The old reading had
 *    the cause and the compensation the wrong way round, and the visible cost was
 *    a pill 8dp wider than the reference's with both glyphs 4dp too far out.
 * 2. "size=20 because Icon.tsx renders at round(size * 1.2), so 20 -> a 24dp
 *    box." The em box was 24dp; the MARK inside it was not. A Lucide glyph inks a
 *    fraction of its em (Icon.tsx's own header measures the set and explains why),
 *    and `search` (uniE151) inks 19.97 of 24 grid units, so at a 24dp em the
 *    magnifier drew 20dp wide against the reference's 13.94dp — 43% oversized.
 *    Matching a 24dp FRAME to a 24dp em matched the wrong two things: the
 *    reference's 24dp is a `createFrame` used for positioning, and its mark is
 *    less than 14dp inside it.
 *
 * The 48dp text inset is CONSTANT — `pEnd` is `dp(48) + additionalIconsWidth`
 * whether or not the clear glyph is showing (`FragmentSearchField.java:242`),
 * which is why the clear slot below is always laid out and only ever animates
 * its opacity, scale and rotation. The previous version mounted a 36dp Pressable
 * on the first keystroke, so the caret jumped sideways as you typed and again
 * when you cleared.
 *
 * That constant is also what makes the touch target free. the reference app's inset is
 * 12 + 24 + 12, and 48 is exactly Android's minimum touch target — "we
 * recommend that each interactive UI element have a focusable area, or touch
 * target size, of at least 48dp x 48dp"
 * (https://developer.android.com/guide/topics/ui/accessibility/apps), which M3
 * restates and which `interaction.minTarget` carries. So each end of the field
 * is ONE 48dp SLOT (`GLYPH_SLOT` below) that is simultaneously the reference's
 * text inset and a compliant target, and the glyph sits centred in it at the
 * reference's 12dp. No `hitSlop` is involved anywhere in this file, deliberately:
 * "the touch area never extends past the parent view bounds"
 * (https://reactnative.dev/docs/view#hitslop), so slop hung on a content-sized
 * parent is slop that does not exist. This is not hypothetical — between
 * 2026-09-06 and 2026-09-07 the clear control was a 24dp `Pressable` with 12dp
 * of slop inside a content-sized `Animated.View`, and the wrapper clipped every
 * bit of the slop back to 24x24dp.
 *
 * Departs from the reference app, on purpose:
 *   - THE PILL FILL IS A SOLID TOKEN, `bg/sunken`, not on-surface ink at 5% /
 *     7%. the reference app composites its fill from the text colour
 *     (`getThemedColor(key_windowBackgroundWhiteBlackText, isDark ? 0.07f :
 *     0.05f)`, `FragmentSearchField.java:275`); this app cannot, and the reason
 *     is a build gate rather than taste. `scripts/check-contrast.mjs` measures
 *     declared token PAIRS and cannot see a composited opacity, so a translucent
 *     fill would take the field's background — the thing the placeholder, the
 *     input text and both glyphs are measured against — outside every contrast
 *     check in the repo. `bg/sunken` exists for exactly this role (its own token
 *     note reads "Search field and disabled fills") and is measurable. The
 *     visual difference is small and in our favour: sunken is the same family of
 *     near-transparent grey, and it does not shift when the surface under the
 *     field changes, which a 5% composite does.
 *   - The clear control's PRESS FEEDBACK is `highlight="ripple"`, the Android
 *     ink ripple at `interaction.rippleRadius` (20dp), not this app's default
 *     Material state layer. Two reasons, and the first is the reference's:
 *     the reference app gives the clear glyph `createSelectorDrawable(key_listSelector,
 *     1, dp(17))` (`FragmentSearchField.java:278`), which IS a RippleDrawable,
 *     and RULE 1 §3 says take the platform's own solution over a hand-rolled
 *     one. The second is that the state layer is a rectangle filling its view:
 *     at 24dp that was a small grey square, but on a 48dp target it would be a
 *     square larger than the 40dp pill containing it. 20dp against the reference app's
 *     17dp is the app's single ripple radius rather than a second number.
 *   - The touch box is the 48dp ROW, not the 40dp pill, and the same for the
 *     clear control. 40dp and 24dp are both below the Android minimum quoted
 *     above. The pill is therefore painted as an absolutely-positioned
 *     background and the input owns the full row.
 *   - Input text is M3 bodyLarge 16dp, not the reference app's 15dp
 *     (`FragmentSearchField.java:97`). ADR-0024 makes the M3 scale the app's type
 *     system and 15 is not a role on it; 1dp is invisible in a 40dp field, a hole
 *     in the scale is not.
 *   - THE ROW'S INSET FROM THE SCREEN EDGE IS NOT 7dp, and it is not symmetric.
 *     The reference's field row is `createFrame(MATCH_PARENT, 48, Gravity.TOP, 7,
 *     -2, 7, 0)` (`DialogsActivity.java:5344`), so with the 4dp padding its pill
 *     sits 11dp from each screen edge. Here the right edge is the app's md
 *     content boundary (16dp, `styles.nav` in HomeScreen) so the pill's right
 *     edge lands at 20dp, and the left edge is whatever the 48dp back arrow plus
 *     an xs gap leaves. Both differences are decisions already taken elsewhere
 *     and neither is this component's to change: 16dp is the app's screen edge
 *     everywhere (the space token's own "16/20/24 rule"), and the reference app has NO
 *     back arrow while search is open — it hides it
 *     (`checkUi_itemBackButtonVisibility`, `DialogsActivity.java:14083-14087`) —
 *     whereas Amit kept ours on 2026-09-06 so a member never sees two crosses.
 *     What IS matched exactly is everything measured from the pill inward.
 *   - Cursor width stays the RN default. the reference app sets 1.5dp
 *     (`FragmentSearchField.java:98`); reactnative.dev/docs/textinput lists every
 *     Android-specific prop and there is no cursor-width control, only
 *     `cursorColor` / `selectionColor` / `selectionHandleColor`.
 *
 * Docked = inline in the row, not a modal/expanding search. The caller controls
 * the value and onChange (controlled input).
 */
import React, { memo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { EASE_OUT_QUINT } from '../theme/motion';
import { Icon } from './Icon';
import { Pressable } from './Pressable';

/*
 * MODULE-PRIVATE, and that is the point rather than an oversight.
 *
 * Both of these were `export const` from the day they were written and nothing
 * outside this file ever imported either one. That is the same failure that got
 * `layout.searchBar` deleted from design/tokens.json in the previous pass: an
 * unread symbol reads as the app's DECLARED GEOMETRY to the next person who
 * greps for it, so a stale one quietly becomes the answer to "how tall is search
 * here?" long after the component has moved on. The token note that replaced
 * `layout.searchBar` points at these two names in this file, which is exactly
 * where they should be readable — and not one line further out.
 *
 * If a second surface ever needs the row height, export it then, with that
 * consumer in the same change.
 */

/** The whole search row. `DialogsActivity.java:295` SEARCH_FIELD_HEIGHT = 48, added at `:5344`. */
const SEARCH_ROW_HEIGHT = 48;

/**
 * The 4dp the pill is inset from the row on ALL FOUR SIDES.
 *
 * `fragmentSearchField.setPadding(dp(4), dp(4), dp(4), dp(4))`
 * (`DialogsActivity.java:3294`), and the pill drawable is bounded to that padding
 * box in `dispatchDraw` (`FragmentSearchField.java:187-193`), so all four sides
 * of it are real. One constant rather than a vertical one and a horizontal one,
 * because in the reference it is one `setPadding` call.
 *
 * The horizontal half USED TO BE DROPPED here on the argument that it only
 * existed to give the blur room to bleed. The header explains why that was a
 * misreading; the short version is that the blur is the thing that cancels the
 * padding, not the thing that needs it.
 */
const PILL_INSET = 4;

/** The visible pill inside the row: 48 minus 4 top and bottom. */
const SEARCH_PILL_HEIGHT = SEARCH_ROW_HEIGHT - PILL_INSET * 2;

/** Both glyph FRAMES, leading and trailing (`FragmentSearchField.java:132`, `:159`). */
const GLYPH_BOX = 24;

/** How far inside the PILL each glyph frame sits — the same two `createFrame` calls. */
const GLYPH_INSET = 12;

/**
 * One end of the field: a 48dp square that holds a 24dp glyph inset 12dp.
 *
 * It is TWO things at once and that coincidence is the whole reason the touch
 * target costs nothing here:
 *
 *   - It is the reference app's constant text inset. `editText.setPadding(dp(48), 0,
 *     dp(48), 0)` (`FragmentSearchField.java:104`), recomputed as
 *     `pEnd = dp(48) + additionalIconsLayout.getMeasuredWidth()` (`:242`), and
 *     12 + 24 + 12 is where that 48 comes from.
 *   - It is Android's minimum touch target, "at least 48dp x 48dp"
 *     (https://developer.android.com/guide/topics/ui/accessibility/apps), which
 *     is `interaction.minTarget` in design/tokens.json.
 *
 * So the slot is laid out as a real 48dp box and the clear `Pressable` fills it,
 * rather than the row carrying 12dp of padding and the glyph being a 24dp view
 * with slop it cannot use. Written as the arithmetic rather than as `48` so a
 * reader can see that the two facts agree, and so changing `GLYPH_INSET` or
 * `GLYPH_BOX` breaks the gate in `__tests__/homeSurface.test.ts` that checks
 * this against `interaction.minTarget` instead of silently shrinking the target.
 *
 * WHERE THE REFERENCE MEASURES THAT 48 FROM, because it is the thing this file
 * got wrong once. Every inset inside the field is measured from the view's
 * PADDING box, not its edge: a `FrameLayout` lays each child out inside the
 * parent's padding, so `createFrame(24, 24, ..., 12, 0, 12, 0)`
 * (`FragmentSearchField.java:132`, `:159`) puts the glyph frame at 4 + 12 = 16
 * from the view's own left edge, and `checkUi_editTextPaddings` (`:239-254`)
 * sets the EditText's 48dp on top of the same 4dp, so the text starts at
 * 4 + 48 = 52. The slot below is therefore a 48dp box carried in on a
 * `PILL_INSET` MARGIN rather than a 52dp box with padding — same two numbers,
 * but the box's centre stays on the glyph's centre, which is what the reveal
 * animation scales about. `styles.glyphSlot` has the rest of that reasoning.
 */
const GLYPH_SLOT = GLYPH_INSET * 2 + GLYPH_BOX;

/**
 * The leading magnifier's `Icon` size, chosen so its INK matches the reference's.
 *
 * The reference's mark is 13.94dp: `res/drawable/outline_search_1_24.xml` is
 * 24dp wide on a 72-unit viewport and its fill path spans x 15.700..57.525, so
 * 41.825 / 72 * 24 = 13.94, and `ImageView.ScaleType.CENTER`
 * (`FragmentSearchField.java:130`) draws a drawable at its intrinsic size
 * without scaling. The 24dp `createFrame` at `:132` is where the mark is PUT,
 * not how big it is.
 *
 * Ours has to be worked back through two steps. `Icon` renders at
 * `Math.round(size * ICON_SCALE)` with `ICON_SCALE = 1.2` (`Icon.tsx`), and a
 * Lucide glyph inks a fraction of its em rather than filling it — `search`
 * (uniE151) inks 19.97 of the 24 grid units the em maps onto, measured with a
 * fontTools outline-bounds pen over `assets/fonts/Lucide.ttf`, which is the
 * method and the caveat Icon.tsx's own header records (the glyf header's
 * xMin/yMin are zeroed by lucide-static and must not be trusted). So:
 *
 *   size 14 -> em round(16.8) = 17 -> ink 17 * 19.97/24 = 14.15dp
 *
 * against the reference's 13.94dp: 0.2dp out, which is a fifth of a pixel at
 * mdpi. The neighbouring steps are worse — size 15 gives an 18dp em and 14.98dp
 * of ink, size 20 (what this was) gives a 24dp em and 19.97dp, 43% oversized.
 *
 * This is the one number in this file that is a JUDGEMENT as much as a
 * measurement, so it is flagged as one: matching the reference's ink means
 * overriding, for this one glyph, Amit's app-wide call that the icons were
 * reading too small (the `ICON_SCALE` docblock). The reference is the standing
 * instruction for this component and the field is where he said the icons look
 * wrong, so it is matched here and nowhere else.
 */
const SEARCH_GLYPH_SIZE = 14;

/**
 * The clear cross's `Icon` size, on the same arithmetic.
 *
 * The reference's mark is 11-12dp: `miniplayer_close.webp` has an intrinsic size
 * of 12x14dp at every density bucket, its alpha bounding box measures 12x12dp at
 * mdpi and 11x11dp at xhdpi and xxhdpi, and `ScaleType.CENTER`
 * (`FragmentSearchField.java:139`) means the 24dp frame at `:159` never scales
 * it either.
 *
 * Lucide's `close` (uniE1B2) inks 13.97 of 24 grid units, so:
 *
 *   size 17 -> em round(20.4) = 20 -> ink 20 * 13.97/24 = 11.64dp
 *
 * which sits inside the 11-12dp the reference's own buckets disagree over. It
 * was size 20 (a 24dp em, 13.97dp of ink) — closer than the magnifier was, but
 * still the larger end of a range it should have been inside.
 */
const CLEAR_GLYPH_SIZE = 17;

/**
 * The clear glyph's reveal, taken whole rather than approximated.
 *
 * `FragmentSearchField.java:57` runs it as a `BoolAnimator` on
 * `CubicBezierInterpolator.EASE_OUT_QUINT` over 380ms;
 * `FragmentFloatingButton.setAnimatedVisibility` is `alpha = f; scale =
 * lerp(0.4, 1, f)` (`FragmentFloatingButton.java:250-258`) and the field adds
 * `closeIcon.setRotation((1 - factor) * 90)` (`FragmentSearchField.java:333`).
 *
 * EASE_OUT_QUINT is (0.23, 1, 0.32, 1) — `CubicBezierInterpolator.java:13`, and
 * the identical four numbers live in the token map as
 * `motion.m3.easing.easeOutQuint`.
 *
 * It is IMPORTED from `src/theme/motion.ts`, not rebuilt here. This file used
 * to derive its own from the same four token numbers — the identical curve,
 * computed twice, which is exactly the drift the "one module knows how motion
 * behaves" rule exists to prevent (art-direction rule 2, DESIGN.md). The
 * duration is a token too (`motion.duration.clearReveal`), so nothing here is
 * a hand-picked number.
 */
const CLEAR_REVEAL = {
  duration: TOKENS.motion.duration.clearReveal,
  easing: EASE_OUT_QUINT,
} as const;
/** `lerp(0.4f, 1f, f)` — FragmentFloatingButton.java:256. */
const CLEAR_HIDDEN_SCALE = 0.4;
/** `(1 - factor) * 90` — FragmentSearchField.java:333. */
const CLEAR_HIDDEN_ROTATION_DEG = 90;

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  /** Called when the clear button is pressed. Default: clears the value. */
  onClear?: () => void;
  /**
   * Leave search entirely. When set, the trailing control becomes ONE control
   * with two jobs, which is what the reference's is.
   *
   * `closeIcon.setOnClickListener` (FragmentSearchField.java:142-155) clears the
   * removable filters if there are any and otherwise runs `onCloseSearch` — so
   * the mark at the right edge is a clear AND an exit, resolved by what there is
   * to clear. Amit, 2026-09-07: "Please bring exit back in search right edge
   * like the reference app."
   *
   * Passing this also FORCES the control visible, because otherwise there would
   * be nothing to press in the state where it exits. That is the reference's own
   * supported mode, not an invention: visibility is
   * `closeButtonForcedVisible || editText.length() > 0` (`:326`) and
   * `setCloseButtonForcedVisible` is a public setter (`:321`). Stated plainly
   * though — DialogsActivity does NOT call it, so the reference app's own dialogs search
   * shows no exit while the field is empty and relies on the system back button.
   * We show one because Amit asked for one.
   */
  onExit?: () => void;
  testID?: string;
}

function SearchBarView({
  value,
  onChangeText,
  placeholder = 'Search',
  onFocus,
  onBlur,
  onClear,
  onExit,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  const hasQuery = value.length > 0;

  /*
   * One control, two jobs, resolved by what there is to clear — the reference's
   * own branch (FragmentSearchField.java:142-155): clear what is clearable, and
   * if there is nothing, leave.
   *
   * The focus call only belongs on the CLEARING branch. Re-focusing the field
   * after being asked to leave it would raise the keyboard on the way out.
   */
  const handleTrailing = () => {
    if (hasQuery) {
      onClear ? onClear() : onChangeText('');
      inputRef.current?.focus();
      return;
    }
    onExit?.();
  };

  /*
   * The clear slot's animation target, not its existence. the reference app never adds or
   * removes the view — `closeIcon` is constructed once and driven by a factor
   * (`checkCloseButtonVisible`, `FragmentSearchField.java:325-333`) — and that is
   * what keeps `pEnd` at a constant `dp(48)` while you type.
   */
  const clearTarget = hasQuery || onExit !== undefined ? 1 : 0;
  const hasText = clearTarget === 1;
  const clearProgress = useSharedValue(clearTarget);
  useEffect(() => {
    clearProgress.value = withTiming(clearTarget, CLEAR_REVEAL);
  }, [clearTarget, clearProgress]);
  const clearStyle = useAnimatedStyle(() => ({
    opacity: clearProgress.value,
    transform: [
      {
        scale:
          CLEAR_HIDDEN_SCALE + (1 - CLEAR_HIDDEN_SCALE) * clearProgress.value,
      },
      { rotate: `${(1 - clearProgress.value) * CLEAR_HIDDEN_ROTATION_DEG}deg` },
    ],
  }));

  return (
    <View testID={testID} style={styles.container}>
      {/* The pill is painted, not laid out: see the header for why the touch box
          has to be the 48dp row rather than the 40dp fill. */}
      <View pointerEvents="none" style={styles.pill} />

      {/* Leading search glyph, centred in a 48dp slot carried in on the pill's
          4dp margin — which puts its 24dp frame at 16..40 from this
          component's edge, i.e.
          12dp inside the pill, the reference's own inset
          (FragmentSearchField.java:132). See SEARCH_GLYPH_SIZE for why the mark
          inside that frame is 14dp and not 20. Not interactive, so the slot is
          only carrying the inset here; the trailing one carries the target. */}
      <View style={styles.glyphSlot}>
        <Icon
          name="search"
          size={SEARCH_GLYPH_SIZE}
          color={theme.color.text.secondary}
        />
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        onFocus={onFocus}
        onBlur={onBlur}
        // Raise the keyboard the moment the field appears. The bar is mounted
        // only when search is entered (TabTopBar renders it on `searching`), so
        // autoFocus fires on that fresh mount and the IME comes up without a
        // second tap. https://reactnative.dev/docs/textinput#autofocus
        autoFocus
        style={styles.input}
        returnKeyType="search"
        clearButtonMode="never"
        disableFullscreenUI
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityRole="search"
        accessibilityLabel={placeholder}
      />

      {/*
        Always laid out, never conditionally mounted — that is the whole point of
        the 48dp constant inset. Which means an always-present control over the
        text field, so it has to be inert while there is nothing to clear, on
        both channels:

        `pointerEvents="none"` takes it out of hit testing entirely — "The View
        is never the target of touch events", and unlike `box-none` it does not
        re-enable its subviews (https://reactnative.dev/docs/view#pointerevents).
        Without it a member would be tapping an invisible 48dp button sitting on
        top of the right-hand end of the field.

        `importantForAccessibility="no-hide-descendants"` takes it out of the
        accessibility tree — "The view is not important for accessibility, nor
        are any of its descendant views"
        (https://reactnative.dev/docs/view#importantforaccessibility). It is the
        Android prop and this app is Android-only; `accessibilityElementsHidden`
        is the iOS one and would do nothing here
        (https://reactnative.dev/docs/view#accessibilityelementshidden). Android's
        own guidance is to hide what is not there rather than to label it:
        "Hide decorative elements"
        (https://developer.android.com/guide/topics/ui/accessibility/apps).

        `disabled` on the Pressable would be wrong on a third count: it routes
        into the 45% opacity dim in Pressable.tsx and announces "disabled" to
        TalkBack, i.e. it would tell a member there is a broken clear button
        rather than no clear button.

        BOTH this wrapper and the Pressable inside it declare the 48dp box. The
        Pressable's own bounds are what Android hit-tests, and a content-sized
        wrapper would clip them — see the header. Declaring it twice means
        neither view can shrink the other by accident.
      */}
      <Animated.View
        style={[styles.clearSlot, clearStyle]}
        pointerEvents={hasText ? 'auto' : 'none'}
        importantForAccessibility={hasText ? 'yes' : 'no-hide-descendants'}>
        <Pressable
          onPress={handleTrailing}
          /* The label has to say which of the two jobs it will do, or a screen
             reader announces "clear" on a control that is about to leave the
             screen. */
          accessibilityLabel={hasQuery ? 'Clear search' : 'Leave search'}
          testID="search-trailing"
          press="none"
          highlight="ripple"
          size={GLYPH_SLOT}
          style={styles.clearTarget}>
          <Icon
            name="close"
            size={CLEAR_GLYPH_SIZE}
            color={theme.color.text.secondary}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export const SearchBar = memo(SearchBarView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: {
      // 48 — DialogsActivity.java:295, :5344. Also the Android minimum target.
      height: SEARCH_ROW_HEIGHT,
      /*
       * Fills its row, and this is not cosmetic.
       *
       * The input inside carries `flex: 1`, which resolves against THIS box.
       * Without a flex here the container hugged its content — an icon and a
       * zero-width input — so the field rendered as a small pill and the text a
       * member typed was invisible. Search still filtered correctly, which is
       * why no test caught it: found on the Redmi 2026-09-06 by typing "Mira"
       * and watching the list narrow to one row with an empty field above it.
       */
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      /*
       * NO `paddingHorizontal`, on purpose, and that is not the same thing as
       * "no inset at all". The reference's insets are all measured from its
       * PADDING box, so each end of this component is a 4dp margin plus a 48dp
       * slot — the pill's inset AND the glyph's 12dp AND a full touch box:
       *
       *   [4 margin][48 slot] + [input] + [48 slot][4 margin]
       *
       * = 52dp to the text and 16dp to the glyph frame, which are the
       * reference's two numbers read from the view's edge. A
       * `paddingHorizontal` here would add to BOTH ends on top of that, which is
       * the failure this comment has warned about since the version that had
       * `paddingHorizontal: 12` with 24dp glyph views and a 12dp input margin —
       * the same 48dp of text inset split across three views, so the interactive
       * one was only 24dp wide. The 4dp lives on the slots, where it can be
       * asymmetric (leading margin left, trailing margin right) the way the
       * reference's padding box is when read from either edge.
       */
    },
    pill: {
      position: 'absolute',
      // 4dp on all four sides is what turns the 48dp row into a 40dp pill and
      // pulls it 4dp in from each end. `dispatchDraw` bounds the drawable to the
      // padding box on every side (FragmentSearchField.java:187-193), from
      // setPadding(dp(4) x4) at DialogsActivity.java:3294. The horizontal half
      // used to be dropped here on a misreading — see the header.
      left: PILL_INSET,
      right: PILL_INSET,
      top: PILL_INSET,
      bottom: PILL_INSET,
      backgroundColor: t.color.bg.sunken,
      // 20 — exactly half the pill, FragmentSearchField.java:275.
      borderRadius: SEARCH_PILL_HEIGHT / 2,
    },
    /*
     * The leading glyph's box and the trailing clear control's box. Same
     * numbers, two names, because they are doing two different jobs: the
     * leading one only holds the inset, the trailing one is a touch target and
     * must not be allowed to drift away from `interaction.minTarget`.
     *
     * Each is a 48dp box pushed in from the component's edge by a `PILL_INSET`
     * MARGIN, which together are 4 + 48 = 52dp of inset to the text and
     * 4 + 12 = 16dp to the glyph frame.
     *
     * A MARGIN AND NOT PADDING ON A 52dp BOX, and the difference is not
     * cosmetic. `clearSlot` is the view the reveal animation scales and rotates
     * (`clearStyle`), and a transform's pivot is the view's own centre. A 52dp
     * box padded 4dp on one side has its centre 2dp away from the glyph's
     * centre, so the mark would drift ~1dp sideways as it scaled up from 0.4 —
     * a wobble on a 380ms animation. A 48dp box with a margin has its centre ON
     * the glyph's centre, which is also what the reference scales: it transforms
     * the 24dp `closeIcon` ImageView itself
     * (`FragmentFloatingButton.setAnimatedVisibility`, `:250-258`), whose pivot
     * is the mark.
     *
     * `height: SEARCH_ROW_HEIGHT` rather than `GLYPH_SLOT` even though both are
     * 48: the height is the ROW's height (DialogsActivity.java:295) and the
     * width is the text inset, and they are equal by coincidence, not by
     * definition. Writing the row height here keeps the slot square if the
     * inset ever changes for a reason of its own.
     */
    glyphSlot: {
      width: GLYPH_SLOT,
      marginLeft: PILL_INSET,
      height: SEARCH_ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearSlot: {
      width: GLYPH_SLOT,
      marginRight: PILL_INSET,
      height: SEARCH_ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearTarget: {
      width: GLYPH_SLOT,
      height: SEARCH_ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    input: {
      flex: 1,
      // The input takes what the two slots and their margins leave (4 + 48 on
      // each side), so the text inset is the 48dp of
      // FragmentSearchField.java:104 measured from the pill, on both sides, in
      // both states — with no margin of its own to add to it.
      height: SEARCH_ROW_HEIGHT,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      // Remove default RN TextInput padding so it sits flush in the pill.
      paddingVertical: 0,
      /*
       * Centre the text in the 48dp row, and take Android's extra font padding
       * out of the way first — the two go together and the platform doc says so.
       *
       * The reference is explicit about the gravity: `editText.setGravity((isRTL
       * ? Gravity.RIGHT : Gravity.LEFT) | Gravity.CENTER_VERTICAL)`
       * (FragmentSearchField.java:107). Here it was left to whatever
       * `textAlignVertical: 'auto'` resolves to, which is
       * `Gravity.NO_GRAVITY` -> the EditText's constructed gravity from the
       * theme's `editTextStyle` (ReactEditText.kt:188-193, :195-200) — an
       * inherited default, not a decision, and not one this file can read.
       * https://reactnative.dev/docs/text-style-props#textalignvertical
       *
       * `includeFontPadding: false` is paired with it on the doc's own
       * instruction, not as an extra opinion: "Set to false to remove extra font
       * padding intended to make space for certain ascenders / descenders. With
       * some fonts, this padding can make text look slightly misaligned when
       * centered vertically. For best results also set textAlignVertical to
       * center." This app sets a custom face (Geist) on this field, which is
       * exactly the "some fonts" case. The chat composer's message field runs
       * the same pair for the same reason — `textAlignVertical: 'center'`
       * declared on its `input` style, and `includeFontPadding: false`
       * arriving with the `bodyMedium` typography token it spreads.
       */
      textAlignVertical: 'center',
      includeFontPadding: false,
    },
  });
