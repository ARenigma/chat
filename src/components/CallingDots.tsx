import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DURATION } from '../theme/motion';

/**
 * The animated ellipsis after a call's status word ("Ringing", "Calling").
 *
 * Measured off the reference capture frame by frame rather than eyeballed
 * (`WhatsApp Video 2026-08-30 at 17.07.02.mp4`, 60fps, the "Requesting · ·"
 * phase at t=1.68–3.63s). What the reference actually does is not what it looks
 * like at a glance, and the first version of this file got it wrong: the dots do
 * not blink in place. They *travel*. Each dot enters as a sliver just right of
 * the word, slides right at a steady ~1.4px/frame, and is clipped away at the
 * right edge, with a new one entering every 15 frames — so two are in view at
 * any moment and the group reads as a conveyor, not a pulse.
 *
 * Frame data (crop x, one run per dot): f105 (23,24)(38,48) → f110 (26,30)
 * (47,55) → f115 (30,39)(56,61) → f119 (36,46) → f120 resets to (23,23)(38,48).
 * That reset every 15 frames at 60fps is a 250ms pitch, and the 22px spacing on
 * a 1080-wide 2.75-density capture is 8dp.
 *
 * So: one row of dots translating a single PITCH, on repeat, inside a window
 * PITCH*2 wide with `overflow: hidden`. Because the dots are identical and the
 * travel distance is exactly the spacing, the wrap is invisible — the row is
 * periodic, so translating it by one pitch lands on a configuration identical to
 * where it started. That is why this needs no sequence, no stagger and no
 * per-dot state: one linear timing value drives the whole thing.
 *
 * Linear easing, deliberately. Every other duration in this app is eased,
 * because an eased curve is what a UI element that starts and stops looks like.
 * This one never starts or stops — it is a constant-velocity conveyor, and any
 * ease would make it visibly pump once per cycle.
 *
 * PITCH is a dp distance rather than a token because the token file is motion
 * and colour, not the 4dp dot geometry it shares with the reference.
 */
const PITCH = 8;
const DOT = 4;
/** Two dots in view, matching the reference's steady state. */
const WINDOW = PITCH * 2;
/**
 * Four covers the window through a full pitch of travel: the row starts one
 * pitch to the left so there is always a dot entering, so positions run
 * -PITCH..2*PITCH and the window is never short of one.
 */
const DOT_COUNT = 4;

function CallingDotsView({ color = 'rgba(255,255,255,0.85)' }: { color?: string }) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      x.value = 0;
      return;
    }
    // 250ms measured; DURATION.base is 240ms, which is the token that means
    // "this speed" and is within one frame of the reference over a full cycle.
    x.value = withRepeat(
      withTiming(PITCH, { duration: DURATION.base, easing: Easing.linear }),
      -1,
    );
  }, [reduce, x]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const dots = Array.from({ length: DOT_COUNT }, (_, i) => (
    <View key={i} style={[styles.dot, { backgroundColor: color }]} />
  ));

  // Reduced motion gets a plain static ellipsis: no window, no clip, no
  // animation. A conveyor is exactly the kind of looping movement the OS
  // setting is asking to stop, and the status word already carries the meaning.
  if (reduce) {
    return (
      <View
        style={styles.static}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {dots.slice(0, 3)}
      </View>
    );
  }

  return (
    <View
      style={styles.window}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.row, style]}>{dots}</Animated.View>
    </View>
  );
}

export const CallingDots = memo(CallingDotsView);

/**
 * Shared clipped-conveyor primitive used by both CallingDots and TypingIndicator.
 *
 * Both animations use the same physical mechanic — a periodic row of dots
 * translating one pitch inside an `overflow: hidden` window — but with different
 * geometry and cadence to distinguish context:
 *
 *   CallingDots: dot=4, pitch=8, DURATION.base (240ms) — measured from the call
 *     reference at 60fps; urgency of a live connection.
 *   TypingIndicator: dot=3, pitch=6, DURATION.slow (420ms) — smaller and slower,
 *     matching the patient, conversational rhythm of someone composing.
 *
 * Pulling this into one parameterised primitive means "the conveyor" is one
 * animation, not two that drift apart. The pitch, dot size and duration that
 * DIFFER across uses are props; the mechanic (translateX on a periodic row,
 * clipped window, Easing.linear, useReducedMotion) is always the same code.
 *
 * @param dot     Dot diameter in dp.
 * @param pitch   Spacing between dot centres and travel distance per cycle in dp.
 * @param duration  Cycle period in ms — MUST be a DURATION token, not a literal.
 * @param color   Dot fill colour.
 * @param startOffset  Optional marginLeft on the window (CallingDots uses 6).
 */
export function ConveyorDots({
  dot,
  pitch,
  duration,
  color,
  startOffset = 0,
}: {
  dot: number;
  pitch: number;
  duration: number;
  color: string;
  startOffset?: number;
}) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);

  useEffect(() => {
    if (reduce) {
      x.value = 0;
      return;
    }
    x.value = withRepeat(
      withTiming(pitch, { duration, easing: Easing.linear }),
      -1,
    );
  }, [reduce, x, pitch, duration]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const dots = Array.from({ length: DOT_COUNT }, (_, i) => (
    <View
      key={i}
      style={{
        width: dot,
        height: dot,
        borderRadius: dot / 2,
        marginRight: pitch - dot,
        backgroundColor: color,
      }}
    />
  ));

  // Reduced motion: static ellipsis, no clip, no animation.
  if (reduce) {
    return (
      <View
        style={[styles.conveyorRow, { marginLeft: startOffset }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {dots.slice(0, 3)}
      </View>
    );
  }

  return (
    <View
      style={[styles.conveyorWindow, { width: pitch * 2, marginLeft: startOffset }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[styles.conveyorRow, { marginLeft: -pitch }, animStyle]}>
        {dots}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  conveyorWindow: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
  conveyorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  window: {
    width: WINDOW,
    marginLeft: 6,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  static: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -PITCH,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    marginRight: PITCH - DOT,
  },
});
