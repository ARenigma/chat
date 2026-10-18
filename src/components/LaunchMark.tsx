/**
 * The cold-start mark (owner, 2026-10-18: "Sides"). The two bubbles of the logo
 * arrive from opposite sides of the screen — coral from the right, the second
 * from the left, the sent and received sides of a chat — meet as the logo, then
 * "Pappal" rises in under it. Replaces the beating heart of 2026-10-17.
 *
 * It exists to mask the boot, so its length is the boot's, not its own: a fixed
 * intro (LAUNCH.intro, the only cost a fast boot pays), then, while a
 * SplashScreen still holds, the bubbles take turns like a conversation, and the
 * exit starts the first poll after the last hold releases. A hold that turns into
 * the slow/retry state releases, so that UI is never covered.
 *
 * Android's own launch screen shows no icon (values-v31/styles.xml), only the
 * page colour, so the first frame here — an empty page — continues it without a
 * jump. Prototyped against Chat/Typing/Zoom and Corners/Drop & rise; the bubble
 * geometry is design/brand/icon-square.png's 1024 master at the 240dp system
 * splash size (×0.234). Two rounded rects with one sharp corner each, so plain
 * Views — no SVG (RULE 5).
 *
 * animate-expo gate: once per process (occasional), purpose "preventing a
 * jarring change" from boot to app. transform/opacity only, on the UI thread.
 * Reduced motion: the lockup is simply there, and fades once nothing holds.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { TOKENS } from '../theme/tokens';
import { EASE_BREATHE, EASE_OUT, LAUNCH } from '../theme/motion';

const WORD = 'Pappal';
/** design/brand/icon-square.png's 1024 master at the 240dp splash size. */
const BUBBLE = { width: 94, height: 53, round: 27, sharp: 6 } as const;
/** How far past its resting place a bubble overshoots before settling, dp. */
const OVERSHOOT = 7;
/** The conversation loop: one bubble lifts this far, then the other answers. */
const BOB = 4;

let holds = 0;
let played = false;

/** SplashScreen calls this while the app is genuinely still loading. */
export function holdLaunch(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      holds -= 1;
    }
  };
}

/** One bubble's entrance: off screen → a small overshoot → rest. */
function arrive(from: number, delay: number) {
  const overshoot = -Math.sign(from) * OVERSHOOT;
  return withDelay(
    delay,
    withSequence(
      withTiming(overshoot, { duration: LAUNCH.travel * 0.7, easing: EASE_OUT }),
      withTiming(0, { duration: LAUNCH.travel * 0.3, easing: EASE_BREATHE }),
    ),
  );
}

/** Lift and settle, then wait out the other bubble's turn; forever. */
function talk(delay: number) {
  const half = LAUNCH.talk / 4;
  return withDelay(
    delay,
    withRepeat(
      withSequence(
        withTiming(1, { duration: half, easing: EASE_BREATHE }),
        withTiming(0, { duration: half, easing: EASE_BREATHE }),
        withTiming(0, { duration: LAUNCH.talk / 2 }),
      ),
      -1,
    ),
  );
}

export function LaunchMark() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  // Once per process: a remount (theme flip, re-gate) must not replay it.
  const [gone, setGone] = useState(played);
  // Far enough that a bubble starts wholly off screen on any width.
  const offscreen = width / 2 + BUBBLE.width;
  const coralX = useSharedValue(reduced ? 0 : offscreen);
  const inkX = useSharedValue(reduced ? 0 : -offscreen);
  const coralBob = useSharedValue(0);
  const inkBob = useSharedValue(0);
  const veil = useSharedValue(1);
  const lockup = useSharedValue(1);

  useEffect(() => {
    if (gone) {
      return;
    }
    played = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (!cancelled) {
        setGone(true);
      }
    };
    const exit = () => {
      if (cancelled) {
        return;
      }
      const duration = reduced ? LAUNCH.fade : LAUNCH.exit;
      if (!reduced) {
        lockup.set(withTiming(1.06, { duration, easing: EASE_OUT }));
      }
      veil.set(
        withTiming(0, { duration, easing: EASE_OUT }, done => {
          if (done) {
            scheduleOnRN(finish);
          }
        }),
      );
    };
    const waitForBoot = () => {
      if (cancelled) {
        return;
      }
      if (holds > 0) {
        timer = setTimeout(waitForBoot, LAUNCH.poll);
      } else {
        exit();
      }
    };
    if (reduced) {
      waitForBoot();
    } else {
      coralX.set(arrive(offscreen, LAUNCH.coralDelay));
      inkX.set(arrive(-offscreen, LAUNCH.inkDelay));
      timer = setTimeout(() => {
        if (holds > 0) {
          coralBob.set(talk(0));
          inkBob.set(talk(LAUNCH.talk / 2));
        }
        waitForBoot();
      }, LAUNCH.intro);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelAnimation(coralBob);
      cancelAnimation(inkBob);
    };
    // Runs once; the shared values are stable and `offscreen` is read at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.get() }));
  const lockupStyle = useAnimatedStyle(() => ({ transform: [{ scale: lockup.get() }] }));
  const coralStyle = useBubbleStyle(coralX, coralBob);
  const inkStyle = useBubbleStyle(inkX, inkBob);

  if (gone) {
    return null;
  }
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.color.bg.base }, veilStyle]}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <View style={styles.centre}>
        <Animated.View style={[styles.lockup, lockupStyle]}>
          <View style={styles.mark}>
            <Animated.View
              style={[styles.bubble, styles.coral, { backgroundColor: theme.color.bg.accent }, coralStyle]}
            />
            {/* The master's second bubble is white on ink; on a white page it takes the ink. */}
            <Animated.View
              style={[styles.bubble, styles.ink, { backgroundColor: theme.color.text.primary }, inkStyle]}
            />
          </View>
          <View style={styles.word}>
            {WORD.split('').map((letter, i) => (
              <Letter
                key={i}
                letter={letter}
                delay={LAUNCH.wordDelay + i * LAUNCH.letterStagger}
                color={theme.color.bg.accent}
                reduced={reduced}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

function useBubbleStyle(x: SharedValue<number>, bob: SharedValue<number>) {
  return useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() },
      { translateY: -BOB * bob.get() },
      { scale: 1 + 0.03 * bob.get() },
    ],
  }));
}

/** A letter rises into place once the mark has formed. */
function Letter({
  letter,
  delay,
  color,
  reduced,
}: {
  letter: string;
  delay: number;
  color: string;
  reduced: boolean;
}) {
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) {
      p.set(withDelay(delay, withTiming(1, { duration: LAUNCH.letter, easing: EASE_OUT })));
    }
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: p.get(),
    transform: [{ translateY: 16 * (1 - p.get()) }, { scale: 0.96 + 0.04 * p.get() }],
  }));
  return (
    <Animated.Text allowFontScaling={false} style={[styles.letter, { color }, style]}>
      {letter}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  centre: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockup: {
    alignItems: 'center',
  },
  mark: {
    width: 112,
    height: 117,
  },
  bubble: {
    position: 'absolute',
    width: BUBBLE.width,
    height: BUBBLE.height,
    borderTopLeftRadius: BUBBLE.round,
    borderTopRightRadius: BUBBLE.round,
  },
  coral: {
    top: 0,
    left: 19,
    borderBottomLeftRadius: BUBBLE.round,
    borderBottomRightRadius: BUBBLE.sharp,
  },
  ink: {
    top: 63,
    left: 0,
    borderBottomLeftRadius: BUBBLE.sharp,
    borderBottomRightRadius: BUBBLE.round,
  },
  word: {
    flexDirection: 'row',
    marginTop: TOKENS.space.lg,
  },
  letter: {
    fontFamily: TOKENS.face.wordmark,
    // A display size for the one full-screen appearance of the wordmark; the
    // wordmark tokens (18/28/34) are sized for chrome.
    fontSize: 52,
    lineHeight: 56,
    includeFontPadding: false,
  },
});
