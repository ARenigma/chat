import { type TextInput } from 'react-native';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { INTERACTION, shakeX, springTo } from '../theme/motion';
import { errorTick, tick } from '../lib/haptics';
import { LoadingIndicator } from './LoadingIndicator';
import { TextField } from './TextField';

/**
 * Per-box success fill delay. Telegram lights each box in turn on a correct code
 * (`LoginActivity.java:4999-5015`, 75ms × index); the whole cascade lands well
 * inside the `STEP_ADVANCE_MS` window before the screen moves on.
 */
const SUCCESS_STAGGER_MS = 70;
/** How long the red error state holds before it clears itself (Telegram: 3s). */
const ERROR_HOLD_MS = 3000;

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Fired once per distinct complete value. See the guard in AuthScreen. */
  onComplete: (code: string) => void;
  length?: number;
  /** Bumped by the caller to shake the field. A counter, not a boolean. */
  errorNonce?: number;
  /**
   * Verification is in flight. The native input deliberately remains editable
   * so Android does not blur it and collapse the IME; changes are ignored until
   * the request settles.
   */
  verifying?: boolean;
  /**
   * The code was accepted. Plays the success cascade before the screen advances.
   * Optional so the standalone AuthScreen path, which has no success state, need
   * not pass it.
   */
  succeeded?: boolean;
  testID?: string;
}

interface SegmentProps {
  char: string;
  index: number;
  active: boolean;
  filled: boolean;
  verifying: boolean;
  /** 0..length, animated; a box lights when this passes its index. */
  successWave: SharedValue<number>;
  /** 0..1, animated; the red error state. */
  errorLevel: SharedValue<number>;
}

/**
 * One box of the code field, with its own animated border and fill.
 *
 * A child component rather than an inline `map` so each box owns a single
 * `useAnimatedStyle` reading the shared `successWave`/`errorLevel` — the wave is
 * the whole point of the success beat, and a box cannot animate its own colour
 * from a value it does not subscribe to.
 */
const Segment = memo(function SegmentView({
  char,
  index,
  active,
  filled,
  verifying,
  successWave,
  errorLevel,
}: SegmentProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const animated = useAnimatedStyle(() => {
    // How lit this box is by the success wave: 0 until the wave reaches it, then
    // ramps to 1 over the next box's width, so the fill sweeps rather than blinks.
    const lit = interpolate(successWave.value, [index, index + 1], [0, 1], 'clamp');
    const err = errorLevel.value;
    // Resting → filled/active → success(sage) → error(red), each winning in turn.
    const restBorder =
      filled || active ? theme.color.text.primary : theme.color.border.strong;
    const borderColor = interpolateColor(
      Math.max(lit, err),
      [0, 1],
      [restBorder, lit >= err ? theme.color.text.positive : theme.color.state.danger],
    );
    const backgroundColor = interpolateColor(
      lit,
      [0, 1],
      [theme.color.bg.raised, theme.color.bg.positive],
    );
    return {
      borderColor,
      backgroundColor,
      transform: [{ scale: 1 + lit * 0.04 }],
    };
  });
  return (
    <Animated.View
      style={[styles.segment, active && styles.segmentActive, verifying && styles.segmentVerifying, animated]}>
      <Text allowFontScaling={false} style={styles.digit}>
        {char}
      </Text>
    </Animated.View>
  );
});

/**
 * One input, drawn as N segments.
 *
 * The conventional pattern is N separate `TextInput`s, and it is worse in three
 * specific ways that all show up on a real device:
 *
 *   1. A screen reader announces six unlabelled edit fields and gives no way to
 *      understand them as one value.
 *   2. Paste fills the first box and drops the rest, because each input has
 *      `maxLength={1}`.
 *   3. Backspace across a boundary is ambiguous, every implementation invents
 *      its own rule for whether it clears the current box or moves back first,
 *      and none of them match the platform.
 *
 * So there is exactly one `TextInput`, stretched across the whole row and painted
 * over by the segments. One accessible node, and backspace is whatever the
 * platform says it is.
 *
 * It is hidden by z-order rather than by `color: 'transparent'`, which is the
 * usual trick and does not work on this build, see the note at the element.
 */
function CodeFieldView({
  value,
  onChange,
  onComplete,
  length = 6,
  errorNonce = 0,
  verifying = false,
  succeeded = false,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const input = useRef<TextInput>(null);
  const shake = useSharedValue(0);
  const successWave = useSharedValue(0);
  const errorLevel = useSharedValue(0);
  const rowScale = useSharedValue(1);
  const [showError, setShowError] = useState(false);
  const lastFired = useRef<string | null>(null);
  const prevLen = useRef(0);

  /**
   * Auto-submit once the code is complete — instantly when it arrives in bulk
   * (autofill or paste), after a short beat when the last digit was typed by
   * hand.
   *
   * The `lastFired` guard stops a rejected code resubmitting on every re-render,
   * which would burn the provider's rate limit and read as the app retrying on
   * its own. It is cleared whenever the value shortens, so fixing a digit and
   * returning to six fires again.
   *
   * The 250ms delay on manual entry is the OTP-UX best practice (Twilio,
   * Baymard): a mistyped sixth digit gets a window to be corrected before the
   * network call, and backspacing inside that window cancels the pending submit
   * via the cleanup. A code that lands whole — grew by more than one character,
   * i.e. autofill or paste — was never read digit-by-digit, so it submits with
   * no delay.
   */
  useEffect(() => {
    if (value.length < length) {
      lastFired.current = null;
      prevLen.current = value.length;
      return;
    }
    if (value === lastFired.current) {
      return;
    }
    const grewByOne = prevLen.current === length - 1;
    prevLen.current = value.length;
    // Claim the value now so an unrelated re-render inside the window cannot
    // schedule a second submit.
    lastFired.current = value;
    if (!grewByOne) {
      onComplete(value);
      return;
    }
    const timer = setTimeout(() => onComplete(value), 250);
    return () => clearTimeout(timer);
  }, [value, length, onComplete]);

  /**
   * Shake, a short haptic, and a red state that clears itself.
   *
   * Telegram fires KEYBOARD_TAP (FLAG_IGNORE_GLOBAL_SETTING) and holds the red
   * for 3s on a wrong code (`LoginActivity.java:6779`, `:6793-6795`); a rejected
   * code at the exact moment someone is already frustrated is precisely where the
   * tactile cue belongs. The physics is in motion.ts (see shakeX). The red clears
   * on its own timer OR as soon as the code is edited, whichever comes first, so
   * correcting a digit takes the field out of the error look immediately.
   */
  useEffect(() => {
    if (errorNonce === 0) {
      return;
    }
    shake.value = shakeX();
    errorTick();
    setShowError(true);
    errorLevel.value = withTiming(1, { duration: TOKENS.motion.duration.instant });
    const timer = setTimeout(() => setShowError(false), ERROR_HOLD_MS);
    return () => clearTimeout(timer);
  }, [errorNonce, shake, errorLevel]);

  // Editing clears the red immediately (before the 3s timer).
  useEffect(() => {
    if (showError) {
      setShowError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!showError) {
      errorLevel.value = withTiming(0, { duration: TOKENS.motion.duration.fast });
    }
  }, [showError, errorLevel]);

  /**
   * The success beat: the boxes fill in turn (sage, the presence/verified colour
   * — not coral, the accent budget is for actions) and the row gives one small
   * pop, before the screen advances. Telegram's per-box cascade + scale spring
   * (`LoginActivity.java:4999-5015`, `CodeNumberField.java:142-144`).
   */
  useEffect(() => {
    if (!succeeded) {
      successWave.value = 0;
      return;
    }
    tick();
    successWave.value = withTiming(length, { duration: length * SUCCESS_STAGGER_MS });
    rowScale.value = springTo(1.03, 'bounce');
    const settle = setTimeout(() => {
      rowScale.value = springTo(1, 'snap');
    }, length * SUCCESS_STAGGER_MS);
    return () => clearTimeout(settle);
  }, [succeeded, length, successWave, rowScale]);

  const rowAnimated = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }, { scale: rowScale.value }],
  }));

  const focus = useCallback(() => {
    const node = input.current;
    if (node === null) {
      return;
    }
    /*
     * Re-open the IME even when the field already holds focus.
     *
     * `TextInput.focus()` is a no-op on Android when the input is already
     * focused, and it does NOT re-show a keyboard the user hid with the IME's
     * own down-chevron — which leaves the field focused. So tapping the boxes
     * after hiding the keyboard that way did nothing (Amit, 2026-09-03). The
     * blur→focus round-trip forces `showSoftInput` to run again; it is
     * invisible here because the field has no caret or selection to flicker
     * (`caretHidden`, `selectionColor: 'transparent'`).
     */
    if (node.isFocused()) {
      node.blur();
    }
    node.focus();
  }, []);

  const onChangeText = useCallback(
    (next: string) => {
      if (verifying || succeeded) {
        return;
      }
      // Digits only, and truncated here rather than trusting maxLength: an
      // autofilled SMS code can arrive with surrounding whitespace.
      onChange(next.replace(/[^\d]/g, '').slice(0, length));
    },
    [onChange, length, verifying, succeeded],
  );

  const filled = value.length;

  return (
    <Animated.View style={rowAnimated}>
      <Pressable
        onPress={focus}
        accessibilityRole="none"
        // The row is a tap target for the hidden input, so the whole thing
        // focuses rather than only the exact glyph position.
        hitSlop={INTERACTION.minTarget / 4}
        style={styles.row}>
        {/* First child, deliberately: the opaque segments below paint over it.
            `color: 'transparent'` is the usual way to hide this input's glyphs
            and it does not work on this build, verified on a device, with
            'transparent' and with 'rgba(0,0,0,0)', both of which left the raw
            "123" visible across the first segment in the input's own font while
            position and fontSize from the same style object applied fine. So the
            glyphs are hidden by z-order instead, which depends on nothing.

            The trade is long-press-paste, which the segments now intercept.
            Android's clipboard chip above the keyboard still inserts into the
            focused field, so pasting a code is preserved by the path people
            actually use. */}
        <TextField
          ref={input}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          // The two that make autofill work. `oneTimeCode` is what iOS reads;
          // `sms-otp` is the Android autofill hint. Both are named because the
          // same component ships to both platforms.
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          importantForAutofill="yes"
          maxLength={length}
          autoFocus
          accessibilityLabel={`Verification code, ${length} digits`}
          // Transparent, not invisible: see the note above about opacity: 0 and
          // the Android keyboard.
          style={styles.input}
          selectionColor="transparent"
          caretHidden
          accessibilityState={{ busy: verifying }}
        />

        {Array.from({ length }, (_, i) => (
          <Segment
            key={i}
            index={i}
            char={i < filled ? (value[i] ?? '') : ''}
            active={!verifying && !succeeded && i === Math.min(filled, length - 1)}
            filled={i < filled}
            verifying={verifying}
            successWave={successWave}
            errorLevel={errorLevel}
          />
        ))}
      </Pressable>

      {/* While the code is in the air the field otherwise looks frozen — the
          segments dim but nothing says the app is working, so a 1–3s verify
          reads as dead (Amit, 2026-09-02). Telegram shows an accent spinner
          during verification (LoginActivity.java:776-781). Centred over the row,
          not replacing it, so the entered digits stay visible behind it. */}
      {verifying ? (
        <View style={styles.verifyOverlay} pointerEvents="none">
          <LoadingIndicator size={28} containerColor="transparent" testID="code-verifying" />
        </View>
      ) : null}
    </Animated.View>
  );
}

export const CodeField = React.memo(CodeFieldView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: TOKENS.space.xs,
      position: 'relative',
    },
    segment: {
      flex: 1,
      height: 60,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.raised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The caret is drawn as a border rather than a real cursor, because the real
    // one belongs to a TextInput that is deliberately not where the glyphs are.
    // Ink, not coral. The accent in this product means "act", the send button,
    // your own bubble, an unread count, and a caret is not an action. Spending it
    // here would put coral on a screen that already has a primary button, which is
    // exactly the competition the accent budget exists to prevent.
    segmentActive: {
      borderWidth: 2,
    },
    // Dimmed while the code verifies, so the centred spinner reads as the active
    // element and the digits sit quietly behind it.
    segmentVerifying: {
      opacity: 0.45,
    },
    verifyOverlay: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    digit: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    input: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // A real font size, so the keyboard and autofill treat this as a normal
      // field. The glyphs themselves are transparent, the visible digits are the
      // Text nodes in the segments above.
      fontSize: 24,
      color: 'rgba(0, 0, 0, 0)',
      // Android can briefly ignore transparent glyph colour while applying an SMS
      // autofill value. Alpha the native input as a whole so raw digits cannot
      // flash over the segmented facade; 0.01, not 0, so it stays laid out,
      // focusable and inside the autofill pipeline (a true 0 can be skipped).
      opacity: 0.01,
    },
  });
