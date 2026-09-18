import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DURATION, EASE_OUT } from '../theme/motion';

/**
 * the reference app outgoing-call halo: a soft glow that breathes out from the avatar.
 * Reference: attached call screen capture (2026-08-30), watched frame-by-frame
 * (2026-08-31). The reference halo is *tight and gentle* — a constant bright
 * ring hugs the avatar, and faint discs expand only ~25% before fading, on a
 * slow ~2.5s cadence. The earlier version ballooned to 1.42× at 0.45 opacity on
 * a 1.26s cycle, which read as an aggressive sonar ping, not a breath. These
 * numbers are the corrected match.
 *
 * Position/size uses springs elsewhere; this is opacity + scale on a decorative
 * ring so timing tokens are correct — it is not a finger-driven surface.
 */

/** One breathing cycle for a pulse disc (ms). Slow, per the reference. */
const RING_CYCLE = DURATION.slow * 6;
/** How far a disc grows past the avatar before it fades. */
const RING_GROWTH = 0.26;
/** Peak opacity of a pulse disc at emission. */
const RING_PEAK = 0.3;

function PulseRing({ delayMs, size }: { delayMs: number; size: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, {
          duration: RING_CYCLE,
          // EASE_OUT from motion.ts, not a hand-typed `Easing.out(Easing.quad)`:
          // same shape (ring expands fast, then slows), but the curve lives in
          // the one module allowed to know how motion behaves.
          easing: EASE_OUT,
          reduceMotion: ReduceMotion.System,
        }),
        -1,
        false,
      ),
    );
  }, [delayMs, t]);

  const style = useAnimatedStyle(() => ({
    opacity: RING_PEAK * (1 - t.value),
    transform: [{ scale: 1 + RING_GROWTH * t.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          marginLeft: -size / 2,
          marginTop: -size / 2,
        },
        style,
      ]}
    />
  );
}

interface Props {
  /** Outer diameter of the avatar face. Rings sit outside it. */
  size: number;
  /** Pulse while ringing / connecting / waiting. Off when the call is live. */
  active: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function CallRing({ size, active, children, style }: Props) {
  // The three discs are staggered evenly across one cycle so a new one emerges
  // as the last is fading — a continuous breath rather than three separate pings.
  const stagger = RING_CYCLE / 3;
  return (
    <View style={[styles.host, { width: size, height: size }, style]}>
      {active ? (
        <>
          {/* Constant inner glow: the bright ring that hugs the avatar in the
              reference, always present under the breathing discs. */}
          <View
            pointerEvents="none"
            style={[
              styles.glow,
              {
                width: size * 1.14,
                height: size * 1.14,
                borderRadius: (size * 1.14) / 2,
                marginLeft: -(size * 1.14) / 2,
                marginTop: -(size * 1.14) / 2,
              },
            ]}
          />
          <PulseRing size={size} delayMs={0} />
          <PulseRing size={size} delayMs={stagger} />
          <PulseRing size={size} delayMs={stagger * 2} />
        </>
      ) : null}
      <View style={[styles.face, { width: size, height: size, borderRadius: size / 2 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  // The constant hugging glow — brighter than a pulse disc but small and fixed.
  glow: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  face: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
