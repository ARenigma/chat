/**
 * The segmented bar across the top of a story: one segment per story of this
 * provider, the played ones full, the current one filling, the rest empty.
 *
 * MOTION (animate-expo, read before writing):
 *   1. Gate: it is not decoration, it is the story's clock, and the only
 *      signal of how long is left. Constant motion, so `linear` (step 5).
 *   2. Thread: the fill is a shared value driven by `withTiming` on the UI
 *      thread; React never renders per frame. Completion reaches the RN
 *      runtime once, through `scheduleOnRN` in the timing callback (step 6).
 *   3. Property: `width` on an absolutely positioned, childless fill, the one
 *      exception step 4 allows, so the rounded end is not smeared by scaleX.
 *   4. Pause keeps the value where it is (`cancelAnimation`) and resume runs
 *      the remaining fraction for the remaining time, so a hold never restarts
 *      the clock.
 *   5. Reduced motion (step 9, and the owner's rule): the clock still runs,
 *      but the fill does not crawl; the segment jumps from empty to full when
 *      the story ends.
 */
import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {

  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { EASE_CONSTANT } from '../../theme/motion';

import { TOKENS } from '../../theme/tokens';

interface Props {
  count: number;
  index: number;
  /** This story's play time in ms. */
  durationMs: number;
  /** False while media loads, and while held, sheeted, blurred or backgrounded. */
  running: boolean;
  /** A key that changes whenever the current story changes, so the clock restarts. */
  storyKey: string;
  onDone: () => void;
}

const SEGMENT_HEIGHT = 2;

function StoryProgressView({ count, index, durationMs, running, storyKey, onDone }: Props) {
  const progress = useSharedValue(0);
  const reduced = useReducedMotion();

  // A new story: the clock starts from nothing.
  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
  }, [storyKey, progress]);

  useEffect(() => {
    if (!running) {
      cancelAnimation(progress);
      return;
    }
    const remaining = Math.max(0, 1 - progress.get());
    progress.set(
      withTiming(1, { duration: Math.max(1, remaining * durationMs), easing: EASE_CONSTANT }, finished => {
        if (finished) {
          scheduleOnRN(onDone);
        }
      }),
    );
    // Leaving mid-segment (back, a new story, pause) stops the clock, so a
    // timing still in flight cannot finish and call a stale onDone.
    return () => cancelAnimation(progress);
  }, [running, durationMs, storyKey, progress, onDone]);

  const fillStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return { width: `${(reduced ? (p >= 1 ? 1 : 0) : p) * 100}%` };
  });

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.track}>
          {i < index ? <View style={[styles.fill, styles.full]} /> : null}
          {i === index ? <Animated.View style={[styles.fill, fillStyle]} /> : null}
        </View>
      ))}
    </View>
  );
}

export const StoryProgress = memo(StoryProgressView);

/*
 * White on the media, in both themes: the bar sits on a photo or video, not on
 * a theme surface, so a themed colour would vanish on half the pictures. The
 * track is the same white at low alpha, the platform's own story idiom.
 */
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: TOKENS.space['2xs'],
  },
  track: {
    flex: 1,
    height: SEGMENT_HEIGHT,
    borderRadius: SEGMENT_HEIGHT,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: SEGMENT_HEIGHT,
    backgroundColor: '#FFFFFF',
  },
  full: {
    width: '100%',
  },
});
