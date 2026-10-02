/**
 * A ring around a round control that empties clockwise as a known wait runs
 * out: the "you asked, they have N seconds to answer" cue.
 *
 * Determinate, because the wait has a known length. "When possible, use a
 * determinate progress indicator. An indeterminate progress indicator shows
 * that a process is occurring, but it doesn't help people estimate how long a
 * task will take." (Apple HIG, Progress indicators); a circular indicator "can
 * be applied directly to a surface, such as a button" (Material components,
 * ProgressIndicator). Owner's pick over a pulsing halo, 2026-10-02.
 *
 * Built from two clipped half-rings that only ROTATE: transform is the one
 * property that animates without a layout pass (animate-expo step 4), and an
 * arc needs no drawing library (react-native-svg is banned here, CLAUDE.md
 * RULE 5). Each half is a full-size ring with two adjacent border sides
 * coloured, rotated 45° so the coloured sides form a semicircle, inside a
 * container that clips it to its own half. Turning a half by -180° carries its
 * arc into the clipped side, out of sight, so the visible arc is
 *   right half: clockwise 0..min(a, 180)
 *   left half:  clockwise 180..a
 * for a remaining angle a = 360 × fraction left. It drains at constant speed:
 * linear, the curve for constant motion (animate-expo step 5), on the UI
 * thread from a single shared value.
 *
 * Reduced motion keeps a static full ring: the label beside the control still
 * says what is happening, and a ring that moves is the part that is dropped.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { EASE_CONSTANT } from '../theme/motion';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  /** Diameter of the control the ring goes around. */
  size: number;
  /** Space between the control's edge and the ring. */
  gap: number;
  /** Ring stroke. */
  thickness: number;
  color: string;
  /** The empty part of the track. */
  trackColor: string;
  /** When the wait began (epoch ms) and how long it lasts. */
  startedAtMs: number;
  durationMs: number;
  testID?: string;
}

export function CountdownRing({
  size,
  gap,
  thickness,
  color,
  trackColor,
  startedAtMs,
  durationMs,
  testID,
}: Props) {
  const reduced = useReducedMotion();
  const ring = size + 2 * (gap + thickness);
  const half = ring / 2;
  const left = useSharedValue(1);

  useEffect(() => {
    const remaining = Math.max(0, startedAtMs + durationMs - Date.now());
    left.set(Math.min(1, remaining / durationMs));
    if (!reduced && remaining > 0) {
      left.set(withTiming(0, { duration: remaining, easing: EASE_CONSTANT }));
    }
    return () => cancelAnimation(left);
  }, [left, reduced, startedAtMs, durationMs]);

  const rightStyle = useAnimatedStyle(() => {
    const a = left.get() * 360;
    return { transform: [{ rotate: `${45 + Math.min(a, 180) - 180}deg` }] };
  });
  const leftStyle = useAnimatedStyle(() => {
    const a = left.get() * 360;
    return { transform: [{ rotate: `${45 + Math.max(a - 180, 0) - 180}deg` }] };
  });

  const arc = {
    width: ring,
    height: ring,
    borderRadius: half,
    borderWidth: thickness,
  };

  return (
    <View
      pointerEvents="none"
      testID={testID}
      style={[
        styles.host,
        { width: ring, height: ring, margin: -(gap + thickness) },
      ]}
    >
      <View style={[styles.fill, arc, { borderColor: trackColor }]} />
      {/* Right half: its arc is the top and right sides. */}
      <View style={[styles.clip, { left: half, width: half, height: ring }]}>
        <Animated.View
          style={[
            arc,
            styles.abs,
            styles.rightArc,
            { left: -half, borderTopColor: color, borderRightColor: color },
            rightStyle,
          ]}
        />
      </View>
      {/* Left half: its arc is the bottom and left sides. */}
      <View
        style={[styles.clip, styles.leftClip, { width: half, height: ring }]}
      >
        <Animated.View
          style={[
            arc,
            styles.abs,
            styles.leftArc,
            { borderBottomColor: color, borderLeftColor: color },
            leftStyle,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute' },
  fill: { position: 'absolute', top: 0, left: 0 },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  abs: { position: 'absolute', top: 0 },
  leftClip: { left: 0 },
  // The two sides each half leaves uncoloured; the coloured pair is set inline
  // because its colour is a prop.
  rightArc: {
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  leftArc: {
    left: 0,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
