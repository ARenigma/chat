import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { VOICE_BARS, padBars } from '../lib/voice';

/**
 * Fixed geometry, and the fixed part is load-bearing.
 *
 * The played portion is drawn as a second copy of the whole bar row, clipped by a
 * narrower parent. That only lines up if both copies have the same intrinsic
 * width, and the only way to get that without measuring is bars of a constant
 * size. Flexed bars would need an `onLayout` round trip before the first frame
 * could be correct, which on a list row means the playhead is wrong for a frame
 * every time a bubble scrolls back into the window.
 */
const BAR_WIDTH = 2;
const BAR_GAP = 2;
const BAR_MIN = 3;
const BAR_MAX = 22;

/** 128pt at the defaults, which fits a bubble beside a button and a duration. */
export const WAVEFORM_WIDTH = VOICE_BARS * (BAR_WIDTH + BAR_GAP);

interface Props {
  /** 0..1 per bar. Any length: `padBars` makes it the drawn width. */
  peaks: readonly number[];
  /** 0..1. Pass 1 for a live meter, which has no unplayed part. */
  progress: number;
  tint: string;
  /** Opacity of the unplayed bars. The only thing distinguishing the two halves. */
  dim: number;
  testID?: string;
}

/**
 * A waveform, with no SVG and no per-bar animation.
 *
 * react-native-svg is banned in this codebase with a named reason, so the bars are
 * Views. That is not a workaround here: thirty-two rectangles is exactly what a
 * View is for.
 *
 * Played versus unplayed is carried by **opacity alone**, which is deliberate on
 * two counts. It needs no second colour token, so `check-contrast.mjs` has no new
 * pair to measure and the accent budget is untouched. And it is the same
 * distinction the rest of the app uses for "this part is done".
 *
 * Nothing animates. The playhead moves because the player reports a new position
 * ten times a second and this row re-renders; interpolating between those reports
 * would mean a shared value per row and a spring that has to agree with audio it
 * cannot hear. Only the row that is playing re-renders, because the position lives
 * in the store behind a per-message selector rather than in the list's data.
 */
function WaveformView({ peaks, progress, tint, dim, testID }: Props) {
  const styles = useStyles(makeStyles);
  const bars = padBars(peaks);
  const row = (
    <View style={styles.row}>
      {bars.map((peak, i) => (
        <View
          key={i}
          style={{
            width: BAR_WIDTH,
            marginRight: BAR_GAP,
            borderRadius: BAR_WIDTH / 2,
            height: BAR_MIN + peak * (BAR_MAX - BAR_MIN),
            backgroundColor: tint,
          }}
        />
      ))}
    </View>
  );

  return (
    <View testID={testID} style={styles.host}>
      <View style={{ opacity: dim }}>{row}</View>
      {/* The played copy, clipped rather than recoloured. `overflow: 'hidden'` on
          a parent whose width is a percentage is the one way to cut a row of
          fixed-width children at an arbitrary point without measuring. */}
      <View
        pointerEvents="none"
        style={[styles.played, { width: `${Math.round(progress * 100)}%` }]}
      >
        {row}
      </View>
    </View>
  );
}

export const Waveform = memo(WaveformView);

// `_t` because every colour here arrives as a prop: the bars take the ink of
// whatever surface they are drawn on, and the played half is an opacity rather
// than a second token.
const makeStyles = (_t: Theme) => StyleSheet.create({
  // Shrinkable and clipped, which is what keeps a voice bubble inside its own
  // rounded rectangle. The row it sits in holds a button, a countdown and a speed
  // slot, and a bubble is capped at 80% of the column: on a 320pt screen that
  // leaves the track under 70pt. Everything else in the row has a fixed width and
  // RN's default `flexShrink` of 0, so all the shrinking lands here.
  //
  // Clipping is honest because the bars are uniform: the visible track is the
  // whole track as far as the eye is concerned, and the playhead is a percentage
  // of *this* box, so it still lands where the audio is. The one place the real
  // peaks are drawn (the composer's review row) has the full width available.
  host: {
    width: WAVEFORM_WIDTH,
    maxWidth: WAVEFORM_WIDTH,
    flexShrink: 1,
    height: BAR_MAX,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_MAX,
  },
  played: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    justifyContent: 'center',
  },
});
