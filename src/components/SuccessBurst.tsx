/**
 * The recharge-success moment (owner, 2026-10-18): the check pops, and ten small
 * pieces of the logo — coral bubbles, ink bubbles, a few dots — burst out from it
 * and fade, with Android's CONFIRM haptic. Then the card is the same still card
 * it always was.
 *
 * animate-expo gate: once per payment (rare), purpose "delight" on a moment that
 * is also state ("the money went through"), so it may spend the delight budget —
 * but stays contained. The last animated success here was a full-bleed field
 * inside the Sheet and was removed as an ornament (PaymentSheet's success card
 * note); this one lives on the 48dp icon and is gone in ~0.65s. transform and
 * opacity only, on the UI thread. Reduced motion: no pop, no burst; the haptic
 * still fires (it respects the system touch-feedback setting on its own).
 *
 * Particles in plain Views, no new dependency (RULE 5); the cheat-sheet name for
 * the technique is "particles", and the pieces are the logo's own bubble shape.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { EASE_BREATHE, EASE_OUT, BURST } from '../theme/motion';
import { confirmTick } from '../lib/haptics';

const COUNT = 10;
/**
 * Fixed, not random: the same burst every time, evenly spread with a little
 * irregularity so it reads as thrown rather than stamped.
 */
const PIECES = Array.from({ length: COUNT }, (_, i) => ({
  angle: ((i * 360) / COUNT - 90 + (i % 2 ? 11 : -7)) * (Math.PI / 180),
  distance: i % 2 ? 66 : 50,
  shape: i % 3 === 2 ? ('dot' as const) : ('bubble' as const),
  coral: i % 2 === 0,
  spin: (i % 2 ? 1 : -1) * (40 + i * 9),
}));

export function SuccessBurst({
  children,
  tones,
}: {
  children: React.ReactNode;
  /** The two piece colours; default coral and ink (on a green field: white and green). */
  tones?: readonly [string, string];
}) {
  const reduced = useReducedMotion();
  const pop = useSharedValue(reduced ? 1 : 0.82);

  useEffect(() => {
    // The beat lands with the pop, once the sheet has stopped moving.
    const timer = setTimeout(confirmTick, BURST.land);
    if (!reduced) {
      pop.set(
        withDelay(
          BURST.land,
          withSequence(
            withTiming(1.1, { duration: BURST.pop * 0.55, easing: EASE_OUT }),
            withTiming(1, { duration: BURST.pop * 0.45, easing: EASE_BREATHE }),
          ),
        ),
      );
    }
    return () => clearTimeout(timer);
    // Once, when the success state appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  return (
    <View style={styles.anchor}>
      {reduced ? null : (
        <View style={styles.origin} pointerEvents="none">
          {/* A zero-size point the flexbox centres on the icon; every piece is
              placed around it. Percent offsets put it ~40dp off on device. */}
          <View style={styles.point}>
            {PIECES.map((piece, i) => (
              <Piece key={i} {...piece} tones={tones} />
            ))}
          </View>
        </View>
      )}
      <Animated.View style={popStyle}>{children}</Animated.View>
    </View>
  );
}

function Piece({
  angle,
  distance,
  shape,
  coral,
  spin,
  tones,
}: (typeof PIECES)[number] & { tones?: readonly [string, string] }) {
  const theme = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(
      withDelay(BURST.land + BURST.delay, withTiming(1, { duration: BURST.travel, easing: EASE_OUT })),
    );
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance;
  const style = useAnimatedStyle(() => {
    const t = p.get();
    return {
      // Visible from launch, gone over the last 45% of the flight.
      opacity: t === 0 ? 0 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45,
      transform: [
        { translateX: dx * t },
        // A little gravity, so the pieces settle rather than freeze.
        { translateY: dy * t + 10 * t * t },
        { rotate: `${spin * t}deg` },
        { scale: 0.6 + 0.4 * Math.min(1, t * 3) },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        shape === 'dot' ? styles.dot : styles.bubble,
        {
          backgroundColor: coral
            ? (tones?.[0] ?? theme.color.bg.accent)
            : (tones?.[1] ?? theme.color.text.primary),
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  anchor: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  origin: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  point: {
    width: 0,
    height: 0,
  },
  // The logo's bubble in miniature: rounded, with one sharp corner.
  bubble: {
    position: 'absolute',
    width: 11,
    height: 7,
    left: -5.5,
    top: -3.5,
    borderTopLeftRadius: 3.5,
    borderTopRightRadius: 3.5,
    borderBottomLeftRadius: 3.5,
    borderBottomRightRadius: 1,
  },
  dot: {
    position: 'absolute',
    width: 5,
    height: 5,
    left: -2.5,
    top: -2.5,
    borderRadius: 2.5,
  },
});
