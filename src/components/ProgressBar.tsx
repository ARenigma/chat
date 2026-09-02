/**
 * M3 Linear Progress Indicator.
 *
 * Spec: https://m3.material.io/components/progress-indicators/specs
 *   Height: 4 dp track.
 *   Determinate: filled indicator at [progress] fraction of the width.
 *   Indeterminate: animated fill that cycles from left to right.
 *
 * Policy (docs/android-audit.md):
 *   - `progress` 0–1 → determinate (uploads, downloads with known %).
 *   - `progress` omitted → indeterminate under app bar / brief chrome waits.
 * Contained LoadingIndicator covers short unknown in-place waits.
 *
 * Implementation: Reanimated width animation; no SVG.  ReduceMotion.System
 * stops the indeterminate cycle after one pass.
 */
import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DURATION } from '../theme/motion';
import { type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

/** Travelling segment length as a fraction of the track, per the M3 specs. */
const INDETERMINATE_SEGMENT = 0.4;

interface Props {
  /**
   * 0–1 for determinate.  `undefined` = indeterminate (animated cycling fill).
   */
  progress?: number;
  /** Track height in dp. Default: 4. */
  height?: number;
  color?: string;
  trackColor?: string;
  testID?: string;
}

function ProgressBarView({
  progress,
  height = 4,
  color: colorProp,
  trackColor: trackColorProp,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // Brand accent by default, matching M3 (progress = primary colour) and the
  // circular LoadingIndicator; callers over a coloured surface still override
  // (media-upload bars pass onAccent). https://m3.material.io/components/progress-indicators/specs
  const color = colorProp ?? theme.color.bg.accent;
  const trackColor = trackColorProp ?? theme.color.bg.sunken;

  const indeterminate = progress === undefined;

  /**
   * The track's own width in px, from layout.
   *
   * It has to be a real number rather than a percentage: the indeterminate pass
   * is a segment that travels the length of the track, and `translateX` takes px.
   * The previous version animated `translateX` by a hard-coded ±100 while leaving
   * the fill at `width: '100%'`, so the segment neither started off-track nor
   * ended off-track on any screen whose bar was not exactly 100px wide.
   */
  const [trackWidth, setTrackWidth] = useState(0);

  // 0 → 1 sweep driving the indeterminate segment across the track.
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (indeterminate && trackWidth > 0) {
      sweep.value = 0;
      sweep.value = withRepeat(
        withTiming(1, { duration: DURATION.spinnerCycle, easing: Easing.inOut(Easing.ease) }),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      );
      return () => cancelAnimation(sweep);
    }
    cancelAnimation(sweep);
    sweep.value = 0;
    return undefined;
  }, [sweep, indeterminate, trackWidth]);

  /**
   * Both branches return BOTH `width` and `transform`, always.
   *
   * Reanimated does not reset a property that a later return value omits, so the
   * old code — `{ width }` when determinate, `{ transform, width }` when not —
   * left the determinate fill wearing the last `translateX` of the indeterminate
   * phase. On device that showed as a short bar floating in the middle of the
   * track instead of a fill growing from the left edge, which is what an upload
   * that starts indeterminate and then reports bytes does on every send.
   */
  const fillStyle = useAnimatedStyle(() => {
    if (!indeterminate) {
      const clamped = Math.min(1, Math.max(0, progress ?? 0));
      return { width: trackWidth * clamped, transform: [{ translateX: 0 }] };
    }
    // M3 indeterminate: a segment ~40% of the track, entering from off-left and
    // leaving off-right. https://m3.material.io/components/progress-indicators/specs
    const segment = trackWidth * INDETERMINATE_SEGMENT;
    return {
      width: segment,
      transform: [{ translateX: -segment + sweep.value * (trackWidth + segment) }],
    };
  });

  return (
    <View
      testID={testID}
      accessible={false}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.fill,
          { height, borderRadius: height / 2, backgroundColor: color },
          fillStyle,
        ]}
      />
    </View>
  );
}

export const ProgressBar = memo(ProgressBarView);

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    track: {
      width: '100%',
      overflow: 'hidden',
    },
    fill: {
      position: 'absolute',
      left: 0,
      top: 0,
    },
  });
