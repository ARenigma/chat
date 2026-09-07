/**
 * The search field, measured off Telegram's CURRENT one.
 *
 * This file used to be built to `m3.material.io/components/search/specs` (56dp
 * pill, radius 28, carried as `layout.searchBar` = 56 in design/tokens.json,
 * now deleted from the token map because nothing read it). That was a
 * deliberate, recorded decision; it is being reversed on the owner's explicit
 * instruction that search should look and move like Telegram's, so the table
 * below is Telegram's MEASUREMENTS and every place this file does something
 * else is named in the departures list under it. Nothing in the table is a
 * claim about what this file does — the departures are.
 *
 * Harvested per ADR-0025: MEASUREMENTS and TIMINGS are facts and are recorded
 * with a `File.java:line` citation; no source, string or asset is copied.
 * Reference is the 12.10.1 (7038) tree, clone `62b56a07`, confirmed upstream
 * HEAD on 2026-09-07. `AndroidUtilities.dp()` is `(int) Math.ceil(density *
 * value)` with no font scaling (`AndroidUtilities.java:2702-2707`), so every
 * Telegram dp maps 1:1 onto a React Native dp and nothing needs converting.
 *
 * IMPORTANT correction to what this repo believed: the numbers previously in
 * here and in `src/theme/motion.ts` were measured off
 * `ActionBar/ActionBarMenuItem.java`, which is Telegram's LEGACY action-bar
 * search — a 36dp-tall bare `EditTextBoldCursor` with `setBackgroundResource(0)`,
 * i.e. no pill at all. The dialogs list has not used that path for several
 * versions. The field it actually ships is
 * `Components/FragmentSearchField.java`, built at `DialogsActivity.java:3285`
 * and added to the content view at `:5344`.
 *
 *   Row height            48dp   DialogsActivity.java:295 (SEARCH_FIELD_HEIGHT), :5344
 *   Pill inset in the row  4dp   DialogsActivity.java:3294 setPadding(dp(4) x4)
 *   Pill height           40dp   48 - 4 - 4
 *   Pill radius           20dp   FragmentSearchField.java:275 createRoundRectDrawable(dp(20))
 *   Pill fill             on-surface ink at 5% light / 7% dark, same line
 *   Glyph boxes         24x24dp  FragmentSearchField.java:132 (search), :159 (clear)
 *   Glyph inset           12dp   the same two createFrame calls
 *   Text inset both ends  48dp   FragmentSearchField.java:104, recomputed at :240-242
 *   Clear reveal    380ms EASE_OUT_QUINT, alpha 0->1, scale 0.4->1, rotate 90->0
 *                          FragmentSearchField.java:57, :330-333;
 *                          FragmentFloatingButton.java:250-258 for the scale ramp
 *   Clear press feedback   a circular ripple, radius 17dp
 *                          FragmentSearchField.java:278
 *                          createSelectorDrawable(key_listSelector, 1, dp(17))
 *
 * The 48dp text inset is CONSTANT — `pEnd` is `dp(48) + additionalIconsWidth`
 * whether or not the clear glyph is showing (`FragmentSearchField.java:242`),
 * which is why the clear slot below is always laid out and only ever animates
 * its opacity, scale and rotation. The previous version mounted a 36dp Pressable
 * on the first keystroke, so the caret jumped sideways as you typed and again
 * when you cleared.
 *
 * That constant is also what makes the touch target free. Telegram's inset is
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
 * Departs from Telegram, on purpose:
 *   - THE PILL FILL IS A SOLID TOKEN, `bg/sunken`, not on-surface ink at 5% /
 *     7%. Telegram composites its fill from the text colour
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
 *     Telegram gives the clear glyph `createSelectorDrawable(key_listSelector,
 *     1, dp(17))` (`FragmentSearchField.java:278`), which IS a RippleDrawable,
 *     and RULE 1 §3 says take the platform's own solution over a hand-rolled
 *     one. The second is that the state layer is a rectangle filling its view:
 *     at 24dp that was a small grey square, but on a 48dp target it would be a
 *     square larger than the 40dp pill containing it. 20dp against Telegram's
 *     17dp is the app's single ripple radius rather than a second number.
 *   - The touch box is the 48dp ROW, not the 40dp pill, and the same for the
 *     clear control. 40dp and 24dp are both below the Android minimum quoted
 *     above. The pill is therefore painted as an absolutely-positioned
 *     background and the input owns the full row.
 *   - Input text is M3 bodyLarge 16dp, not Telegram's 15dp
 *     (`FragmentSearchField.java:97`). ADR-0024 makes the M3 scale the app's type
 *     system and 15 is not a role on it; 1dp is invisible in a 40dp field, a hole
 *     in the scale is not.
 *   - The pill is flush with this component's left and right edges rather than
 *     inset 4dp horizontally. Telegram's padding is symmetric on all four sides,
 *     but the horizontal half exists only so `setupBlurredBackground` has 4dp to
 *     bleed into (`FragmentSearchField.java:196-201`), and there is no blur here.
 *     The vertical 4dp — the half that produces the 40dp pill — is kept exactly.
 *   - Cursor width stays the RN default. Telegram sets 1.5dp
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
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
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

/** The visible pill inside it: 48 minus the 4dp inset on each side (`DialogsActivity.java:3294`). */
const SEARCH_PILL_HEIGHT = 40;

/** Both glyph boxes, leading and trailing (`FragmentSearchField.java:132`, `:159`). */
const GLYPH_BOX = 24;

/** How far inside the pill each glyph box sits — the same two `createFrame` calls. */
const GLYPH_INSET = 12;

/**
 * One end of the field: a 48dp square that holds a 24dp glyph inset 12dp.
 *
 * It is TWO things at once and that coincidence is the whole reason the touch
 * target costs nothing here:
 *
 *   - It is Telegram's constant text inset. `editText.setPadding(dp(48), 0,
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
 */
const GLYPH_SLOT = GLYPH_INSET * 2 + GLYPH_BOX;

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
 * the identical four numbers already live in the token map as
 * `motion.m3.easing.easeOutQuint`. It is rebuilt here rather than imported
 * because `src/theme/motion.ts` keeps its copy module-private; the duration is
 * still a token (`motion.duration.clearReveal`), so nothing here is a hand-picked
 * number. Precedent for a component holding a bezier read from the token map is
 * `Composer.tsx:101` (KEYBOARD_EASING).
 */
const EASE_OUT_QUINT = Easing.bezier(
  TOKENS.motion.m3.easing.easeOutQuint[0],
  TOKENS.motion.m3.easing.easeOutQuint[1],
  TOKENS.motion.m3.easing.easeOutQuint[2],
  TOKENS.motion.m3.easing.easeOutQuint[3],
);
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
  testID?: string;
}

function SearchBarView({
  value,
  onChangeText,
  placeholder = 'Search',
  onFocus,
  onBlur,
  onClear,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);

  const handleClear = () => {
    onClear ? onClear() : onChangeText('');
    inputRef.current?.focus();
  };

  /*
   * The clear slot's animation target, not its existence. Telegram never adds or
   * removes the view — `closeIcon` is constructed once and driven by a factor
   * (`checkCloseButtonVisible`, `FragmentSearchField.java:325-333`) — and that is
   * what keeps `pEnd` at a constant `dp(48)` while you type.
   */
  const clearTarget = value.length > 0 ? 1 : 0;
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

      {/* Leading search glyph, centred in its 48dp slot — which puts it 12dp
          inside the pill, the reference's own inset
          (FragmentSearchField.java:132). size=20 because Icon.tsx:98 renders at
          round(size * 1.2), so 20 -> a 24dp box. Not interactive, so the slot is
          only carrying the inset here; the trailing one carries the target. */}
      <View style={styles.glyphSlot}>
        <Icon name="search" size={20} color={theme.color.text.secondary} />
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        onFocus={onFocus}
        onBlur={onBlur}
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
          onPress={handleClear}
          accessibilityLabel="Clear search"
          press="none"
          highlight="ripple"
          size={GLYPH_SLOT}
          style={styles.clearTarget}>
          <Icon name="close" size={20} color={theme.color.text.secondary} />
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
       * NO horizontal padding, on purpose. The 12dp glyph inset
       * (FragmentSearchField.java:132, :159) is inside each 48dp slot rather
       * than outside it, which is what lets the trailing slot be a real 48dp
       * touch box while the text inset stays at the reference's constant 48dp:
       *
       *   0 + [48 slot] + [input] + [48 slot] + 0
       *
       * It used to be `paddingHorizontal: 12` with 24dp glyph views and a 12dp
       * margin on the input — the same 48dp of text inset, but split across
       * three views, so the interactive one was only 24dp wide.
       */
    },
    pill: {
      position: 'absolute',
      left: 0,
      right: 0,
      // 4dp top and bottom is what turns the 48dp row into a 40dp pill
      // (DialogsActivity.java:3294). The horizontal half is dropped — see header.
      top: (SEARCH_ROW_HEIGHT - SEARCH_PILL_HEIGHT) / 2,
      bottom: (SEARCH_ROW_HEIGHT - SEARCH_PILL_HEIGHT) / 2,
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
     * `height: SEARCH_ROW_HEIGHT` rather than `GLYPH_SLOT` even though both are
     * 48: the height is the ROW's height (DialogsActivity.java:295) and the
     * width is the text inset, and they are equal by coincidence, not by
     * definition. Writing the row height here keeps the slot square if the
     * inset ever changes for a reason of its own.
     */
    glyphSlot: {
      width: GLYPH_SLOT,
      height: SEARCH_ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearSlot: {
      width: GLYPH_SLOT,
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
      // The input takes what the two 48dp slots leave, so the text inset is the
      // 48dp of FragmentSearchField.java:104 on both sides, in both states —
      // with no margin of its own to add to it.
      height: SEARCH_ROW_HEIGHT,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      // Remove default RN TextInput padding so it sits flush in the pill.
      paddingVertical: 0,
    },
  });
