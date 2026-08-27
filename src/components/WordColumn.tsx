import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ZoomInLeft,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import {
  CAROUSEL_ENTER_OFFSET,
  CAROUSEL_SLIDE_MS,
  CAROUSEL_SNAP_MS,
  COLUMN_HEIGHT,
  COLUMN_OFFSET,
  DIM_OPACITY,
  DWELL_MS,
  HIGHLIGHT_INDEX,
  ROW_HEIGHT,
  windowAt,
} from '../lib/carouselWindow';

/**
 * Deliberately NOT the source's `maxHeight: 38`.
 *
 * The source's marks are full-colour illustrations, which hold their weight at
 * 38pt. This app's icons are hand-drawn line geometry built for the 20-28pt tab
 * bar, and their stroke weight does not scale with the box: at 38 the `phone`
 * arc reads as a stray curve and `bubble` reads as an empty rectangle, which is
 * what the first build on device showed. 28 is the top of the range they were
 * actually drawn for, and against a 40pt word it is the right proportion.
 *
 * Matching the reference's number here would mean matching it in the one place
 * our materials differ from theirs.
 */
const GLYPH = 20;

/**
 * A word and the mark that rides with it.
 *
 * The source pairs every carousel entry with its own image
 * (`Carousel(text: "Pay", image: "pay")`) rather than repeating one mark, which
 * is what makes the highlighted row feel like it is about something instead of
 * just being the loud one. Using the app's own modality icons keeps that
 * property without inventing art.
 */
export interface Word {
  readonly text: string;
  readonly glyph: IconName;
  /**
   * The mark's colour, one token per word.
   *
   * The reference gives every carousel entry its own full-colour pictogram —
   * a red card for Pay, blue bars for Invest, an orange cart for Spend — and
   * that variety is what stops the glyph reading as decoration attached to
   * whichever row happens to be lit. Our icons are line marks rather than
   * artwork, so colour is the only channel available to carry the same
   * per-word identity. Repeating one accent on every row, which is what this
   * shipped with first, throws that away.
   */
  readonly color: string;
}


interface Props {
  words: readonly Word[];
  testID?: string;
}

/**
 * The word carousel from the reference, rebuilt.
 *
 * **The highlighted row is the middle one.** Five rows are rendered into a frame
 * three rows tall, so the stack overflows by one row at each end and the centre
 * row is the one the eye lands on. Rendering three rows and highlighting the
 * first, which is what a screenshot suggests, produces a completely different
 * object: nothing is ever entering or leaving, so the movement has no runway.
 *
 * **Only the highlighted row carries a glyph**, and it enters from the leading
 * edge. In the source that is `.move(edge: .leading) + .opacity + .scale`, which
 * is the one moment of character in an otherwise still block.
 *
 * **The edges dissolve rather than clip.** The source masks the column so it is
 * clear at the top, opaque through the middle 40%, and clear again at the
 * bottom. Without that the outer rows end in a hard cut and the whole thing
 * reads as a truncated list rather than as a window onto something continuous.
 * React Native cannot mask an arbitrary subtree without a dependency, so the
 * same result is produced by fading each row by its distance from the centre,
 * which is what the mask resolves to anyway.
 *
 * **Reduce Motion stops the rotation.** A word that changes every two seconds
 * forever is exactly what somebody who asked the OS for less movement asked to
 * be rid of, so the column holds one word.
 *
 * **Slide is UI-thread-driven.** A `withRepeat` shared value owns the vertical
 * translate so the slide never depends on the JS-thread `setInterval` callback.
 * Under JS pressure (e.g. a Google OAuth hand-off) the slide continues
 * uninterrupted on the UI thread. A lightweight JS timer still fires every
 * `DWELL_MS` to advance the word index and re-key the glyph, which is cheap
 * work and cannot stall the visual slide even if it is delayed.
 */
function WordColumnView({ words, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);

  /*
   * Lightweight JS timer: advances the word index once per dwell.
   * This is the ONLY JS-thread involvement in the cycle. The slide itself
   * runs on the UI thread independently (see shift below), so a delayed
   * callback here only affects which words are shown, not whether the slide
   * looks smooth.
   */
  useEffect(() => {
    if (reduced || words.length < 2) {
      return;
    }
    const id = setInterval(() => setTick(t => t + 1), DWELL_MS);
    return () => clearInterval(id);
  }, [reduced, words.length]);

  /*
   * UI-thread continuous slide loop.
   *
   * A single `withRepeat(withSequence(...))` drives the vertical translate
   * entirely on the UI thread — no React re-render is involved in the motion.
   * Each lap:
   *   1. Snap to CAROUSEL_ENTER_OFFSET (instant, 0 ms) — pre-positions the
   *      stack one row above where the eye sees it, pixel-identical to the
   *      settled state before any advance.
   *   2. Slide to 0 over CAROUSEL_SLIDE_MS — the visible movement.
   *   3. Dwell at 0 for the remaining time until the next lap.
   * One lap total = CAROUSEL_SLIDE_MS + (DWELL_MS − CAROUSEL_SLIDE_MS) = DWELL_MS,
   * keeping the slide in step with the JS word-index timer.
   *
   * `ReduceMotion.Never` is intentional and matches the pattern in
   * `carouselLoop()` in motion.ts: the reduce-motion gate is the `if (reduced)`
   * guard above this effect, not a flag inside the animation. Passing
   * `ReduceMotion.System` to a `withRepeat` that drives a
   * `withTiming(0, {duration: 0})` final step would spin at frame rate forever
   * doing nothing instead of stopping.
   */
  const shift = useSharedValue(0);
  useEffect(() => {
    if (reduced || words.length < 2) {
      shift.value = 0;
      return;
    }
    shift.value = withRepeat(
      withSequence(
        // 1. Instant snap to the pre-advance offset. CAROUSEL_SNAP_MS = 0 so
        //    the stack jumps in the same frame — no visible flash.
        withTiming(CAROUSEL_ENTER_OFFSET, { duration: CAROUSEL_SNAP_MS }),
        // 2. Slide the stack into place.
        withTiming(0, { duration: CAROUSEL_SLIDE_MS, easing: Easing.out(Easing.quad) }),
        // 3. Dwell: `withTiming(0, …)` that starts and ends at 0 is a no-op
        //    whose only purpose is to spend time before the next snap.
        withTiming(0, { duration: DWELL_MS - CAROUSEL_SLIDE_MS }),
      ),
      -1,
      // Reduce-motion is gated by the `if (reduced)` check above; this block
      // is never reached when the system flag is on, so no ReduceMotion arg
      // is needed — the default (System) is unreachable here.
    );
    return () => cancelAnimation(shift);
  }, [reduced, words.length, shift]);

  const sliding = useAnimatedStyle(() => ({
    transform: [{ translateY: shift.value }],
  }));

  const rows = windowAt(tick, words.length);

  return (
    <View testID={testID} style={styles.column}>
      <Animated.View style={[styles.stack, sliding]}>
        {rows.map((wordIndex, row) => {
          const highlighted = row === HIGHLIGHT_INDEX;
          /*
           * Distance from the centre row, normalised, is what the source's mask
           * resolves to. Row 2 is 0 and fully opaque; rows 0 and 4 are 1 and
           * fully gone.
           */
          const distance = Math.abs(row - HIGHLIGHT_INDEX) / (HIGHLIGHT_INDEX + 1);
          const edgeFade = Math.max(0, 1 - distance * 1.5);
          // Opacity is the one property that genuinely varies per row and per
          // tick, so it cannot live in the stylesheet.
          const fade = { opacity: highlighted ? 1 : DIM_OPACITY * edgeFade };
          return (
            <View
              // Keyed by row rather than by word: the row is the fixed slot and
              // the word moving through it is the animation. Keying by word would
              // make React reorder the nodes and the movement would vanish.
              key={row}
              style={[styles.row, fade]}>
              {highlighted ? (
                <Animated.View
                  key={`glyph-${wordIndex}`}
                  /*
                   * `.move(edge: .leading).combined(with: .opacity).combined(with: .scale)`
                   * from the source. The mark slides in from the left AND grows,
                   * which is the one moment of character in an otherwise still
                   * block; a plain fade, which is what shipped first, throws
                   * both halves away.
                   *
                   * `ZoomInLeft` is the one preset that carries all three at
                   * once. Hand-combining them via `withInitialValues` does not
                   * compile: that option is typed per-animation, so `ZoomIn`
                   * accepts only a scale and `FadeIn` only an opacity.
                   *
                   * The glyph entrance re-fires whenever `wordIndex` changes,
                   * which happens on the JS tick. The UI-thread slide is
                   * independent, so both animations coexist without blocking
                   * each other.
                   */
                  entering={
                    reduced ? undefined : ZoomInLeft.duration(TOKENS.motion.duration.base)
                  }
                  style={styles.glyph}>
                  <Icon
                    name={words[wordIndex]?.glyph ?? 'chat'}
                    size={GLYPH}
                    color={words[wordIndex]?.color ?? theme.color.bg.accent}
                  />
                </Animated.View>
              ) : null}
              <Text
                allowFontScaling
                numberOfLines={1}
                style={[styles.word, highlighted && styles.wordOn]}>
                {words[wordIndex]?.text}
              </Text>
            </View>
          );
        })}
      </Animated.View>

    </View>
  );
}

export const WordColumn = memo(WordColumnView);

const makeStyles = (t: Theme) => StyleSheet.create({
  /*
   * Five rows in a three-row frame, pulled up by one row so the middle of the
   * window sits in the middle of the frame. `overflow: hidden` is what turns the
   * two extra rows into runway rather than into layout.
   */
  column: {
    height: COLUMN_HEIGHT,
    overflow: 'hidden',
  },
  // The stack is what moves, not the frame. See COLUMN_OFFSET for why doing this
  // with margin and padding on the frame itself silently clips the active row.
  stack: {
    marginTop: COLUMN_OFFSET,
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    // The source's `HStack(spacing: 16)`, not a token lookup that happens to be
    // close, because the glyph-to-word relationship is the reference's.
    gap: 16,
  },
  glyph: {
    width: GLYPH,
    alignItems: 'center',
  },
  word: {
    fontFamily: TOKENS.typography.displayLarge.fontFamily,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -1,
    color: t.color.text.primary,
  },
  wordOn: {
    color: t.color.text.primary,
  },
});
