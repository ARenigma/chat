import { type TextInput } from 'react-native';
import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { INTERACTION, shakeX } from '../theme/motion';
import { TextField } from './TextField';

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
  testID?: string;
}

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
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const input = useRef<TextInput>(null);
  const shake = useSharedValue(0);
  const lastFired = useRef<string | null>(null);

  /**
   * Auto-submit on the last character, once per distinct value.
   *
   * Without the `lastFired` guard a rejected code resubmits on every re-render,
   * which burns the provider's rate limit and looks to the user like the app is
   * retrying on its own. Cleared whenever the value shortens, so correcting one
   * digit and returning to six fires again.
   */
  useEffect(() => {
    if (value.length < length) {
      lastFired.current = null;
      return;
    }
    if (value !== lastFired.current) {
      lastFired.current = value;
      onComplete(value);
    }
  }, [value, length, onComplete]);

  /**
   * Shake, and keep the digits. The physics is in motion.ts, see shakeX for why
   * nothing is cleared here.
   */
  useEffect(() => {
    if (errorNonce === 0) {
      return;
    }
    shake.value = shakeX();
  }, [errorNonce, shake]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value }],
  }));

  const focus = useCallback(() => {
    input.current?.focus();
  }, []);

  const onChangeText = useCallback(
    (next: string) => {
      if (verifying) {
        return;
      }
      // Digits only, and truncated here rather than trusting maxLength: an
      // autofilled SMS code can arrive with surrounding whitespace.
      onChange(next.replace(/[^\d]/g, '').slice(0, length));
    },
    [onChange, length, verifying],
  );

  const filled = value.length;

  return (
    <Animated.View style={animated}>
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

        {Array.from({ length }, (_, i) => {
          const active = !verifying && i === Math.min(filled, length - 1);
          const hasDigit = i < filled;
          return (
            <View
              key={i}
              style={[
                styles.segment,
                hasDigit && styles.segmentFilled,
                active && styles.segmentActive,
              ]}>
              <Text allowFontScaling={false} style={styles.digit}>
                {hasDigit ? value[i] : ''}
              </Text>
            </View>
          );
        })}

      </Pressable>
    </Animated.View>
  );
}

export const CodeField = React.memo(CodeFieldView);

const makeStyles = (t: Theme) => StyleSheet.create({
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
  segmentFilled: {
    borderColor: t.color.text.primary,
  },
  // The caret is drawn as a border rather than a real cursor, because the real
  // one belongs to a TextInput that is deliberately not where the glyphs are.
  // Ink, not coral. The accent in this product means "act", the send button,
  // your own bubble, an unread count, and a caret is not an action. Spending it
  // here would put coral on a screen that already has a primary button, which is
  // exactly the competition the accent budget exists to prevent.
  segmentActive: {
    borderColor: t.color.text.primary,
    borderWidth: 2,
  },
  digit: {
    ...TOKENS.typography.displaySmall,
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
    // flash over the segmented facade; it remains laid out and focusable.
    opacity: 0.01,
  },
});
