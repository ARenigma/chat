import React, { memo, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import { DURATION } from '../theme/motion';
import { fadeStop } from '../lib/bloom';
import {
  COMET_REST_MIN_MS,
  COMET_REST_SPAN_MS,
  COMET_SHOOT_MS,
  STAR_TWINKLE_MS,
  cometFade,
  makeCometPath,
  makeStars,
  type Star,
} from '../lib/nightSky';

/**
 * The onboarding backdrop's dark negative space, restyled as a night sky —
 * twinkling stars and an occasional comet — mounted BEHIND `BloomField`.
 *
 * **This does not touch the Fuse bloom system.** `BLOOM_LAYERS`, the stage
 * cross-fade, the collapse geometry and the coral palette in `lib/bloom.ts`
 * and `BloomField.tsx` are all unchanged (Amit, 2026-09-12: "i hope we are
 * not touching the fuse bloom system animation mechanics itself"). This is a
 * new, independent decorative layer with its own animation loop, painted
 * UNDER the coral gradients so it only shows through the space the bloom
 * doesn't reach — which is exactly the flat, unpolished area it was built to
 * fix.
 *
 * **The one necessary wiring change**: `BloomField`'s host view used to paint
 * the flat `bg/raised` fill itself, opaquely, which would hide anything
 * mounted behind it. That solid fill moved here — this component now owns
 * it — and `BloomField`'s host became transparent. That is a paint-order
 * change, not a mechanics change: nothing about how the bloom animates,
 * times, or colours itself was touched.
 *
 * **Corner vignette, not a bloom retune.** A soft dark-to-transparent radial
 * in the top corners gives the untouched negative space its own luminance
 * step (MD3's tonal-elevation guidance: depth from layered luminance, not
 * one flat tone) — reusing `fadeStop` from `lib/bloom.ts`, the same
 * premultiplied-safe gradient technique already proven down to API 24,
 * rather than inventing a second one.
 *
 * **Stars and the comet are seeded once per mount**, not re-randomised on
 * every render — a starfield that reshuffles itself on a re-render would
 * read as a glitch, not a sky. Durations live in `lib/nightSky.ts`, not as
 * literals here — see that file's header for why.
 */

const VIGNETTE_COLOR = '#0F1620';

function Twinkle({ star }: { star: Star }) {
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = withDelay(
      star.twinkleDelay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: STAR_TWINKLE_MS, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: STAR_TWINKLE_MS, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
  }, [progress, star.twinkleDelay]);
  const style = useAnimatedStyle(() => ({
    opacity: star.baseOpacity * (0.4 + progress.value * 0.6),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.star,
        {
          left: star.x - star.size,
          top: star.y - star.size,
          width: star.size * 2,
          height: star.size * 2,
          borderRadius: star.size,
        },
        style,
      ]}
    />
  );
}

/**
 * One comet, looping on a random-ish rest between shots. `Easing.inOut(Easing.cubic)`
 * throughout — Amit: "motion should be smooth" — so the sweep accelerates out
 * of its start and decelerates into its end rather than moving at a constant
 * rate, and `cometFade` eases both fade edges rather than cutting abruptly.
 */
function Comet({ width, height }: { width: number; height: number }) {
  const progress = useSharedValue(0);
  const path = useMemo(
    () => makeCometPath(Math.floor(Date.now() / 16), width, height),
    [width, height],
  );

  React.useEffect(() => {
    const rest = COMET_REST_MIN_MS + Math.random() * COMET_REST_SPAN_MS;
    // The reset to 0 happens after `rest`, while the comet is already faded
    // out (past t=0.85 in `cometFade`) — so `DURATION.instant` is imperceptible
    // here, not a stand-in for a true zero.
    const shoot = withSequence(
      withTiming(1, { duration: COMET_SHOOT_MS, easing: Easing.inOut(Easing.cubic) }),
      withDelay(rest, withTiming(0, { duration: DURATION.instant })),
    );
    progress.value = withRepeat(shoot, -1, false);
  }, [progress]);

  const trailLength = 64;
  const groupStyle = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: cometFade(t),
      transform: [
        { translateX: path.startX + path.dx * t },
        { translateY: path.startY + path.dy * t },
        { rotate: `${path.angle}deg` },
      ],
    };
  });

  // Reuses fadeStop's same-hue-at-alpha-0 rule: a white trail must fade to
  // white-at-zero-alpha, not to transparent black, or it drags toward grey on
  // non-premultiplied renderers (API 24). Built once, not per render, since
  // the gradient string never changes.
  const trailGradient = useMemo(
    () =>
      `linear-gradient(90deg, ${fadeStop('#FFFFFF')} 0%, rgba(255,255,255,0.7) 70%, #FFFFFF 100%)`,
    [],
  );

  return (
    <Animated.View pointerEvents="none" style={[styles.cometGroup, groupStyle]}>
      <View
        style={[
          styles.cometTrail,
          {
            width: trailLength,
            experimental_backgroundImage: trailGradient,
            transform: [{ translateX: -trailLength }],
          },
        ]}
      />
      <View style={styles.cometHead} />
    </Animated.View>
  );
}

export function NightSkyView() {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const stars = useMemo(() => makeStars(Date.now(), width, height), [width, height]);

  return (
    <View
      pointerEvents="none"
      style={[styles.host, { backgroundColor: theme.color.bg.raised }]}>
      <View style={[styles.vignette, styles.vignetteTopLeft]} />
      <View style={[styles.vignette, styles.vignetteTopRight]} />
      {stars.map((star, i) => (
        <Twinkle key={i} star={star} />
      ))}
      <Comet width={width} height={height} />
    </View>
  );
}

export const NightSky = memo(NightSkyView);

// Module-level, not per-render: the gradient string never changes.
const VIGNETTE_GRADIENT = `radial-gradient(circle closest-side at 50% 50%, ${VIGNETTE_COLOR} 0%, ${fadeStop(VIGNETTE_COLOR)} 100%)`;

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
  },
  star: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  vignette: {
    position: 'absolute',
    width: 260,
    height: 260,
    opacity: 0.85,
    experimental_backgroundImage: VIGNETTE_GRADIENT,
  },
  vignetteTopLeft: { left: -60, top: -60 },
  vignetteTopRight: { right: -60, top: -80 },
  cometGroup: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  cometTrail: {
    height: 2,
    borderRadius: 1,
  },
  cometHead: {
    position: 'absolute',
    right: -2.5,
    top: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
});
