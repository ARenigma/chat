import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ZoomInLeft,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import {
  CAROUSEL_ENTER_OFFSET,
  CAROUSEL_SLIDE_MS,
  COLUMN_HEIGHT,
  COLUMN_OFFSET,
  DIM_OPACITY,
  DWELL_MS,
  HIGHLIGHT_INDEX,
  windowAt,
} from '../lib/carouselWindow';
import { ROW_HEIGHT } from '../lib/carouselWindow';

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
const GLYPH = 28;

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
 */
function WordColumnView({ words, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduced || words.length < 2) {
      return;
    }
    const id = setInterval(() => setTick(t => t + 1), DWELL_MS);
    return () => clearInterval(id);
  }, [reduced, words.length]);

  /*
   * The slide. See `CAROUSEL_ENTER_OFFSET` for why this exists at all.
   *
   * Every advance renders the new window already translated up by one row, which
   * is pixel-identical to the picture before the advance, and then settles it to
   * zero. The eye sees every row travel one slot downward, which is what the
   * source's `insert(at: 0)` produces and what a still frame cannot show.
   *
   * Skipped on the first render, because there is nothing to slide from.
   */
  const shift = useSharedValue(0);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduced) {
      return;
    }
    shift.value = CAROUSEL_ENTER_OFFSET;
    shift.value = withTiming(0, {
      duration: CAROUSEL_SLIDE_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [tick, reduced, shift]);

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
  // 40pt medium, the source's `.system(size: 40, weight: .medium)`.
  word: {
    fontFamily: TOKENS.typography.displayLarge.fontFamily,
    fontSize: 40,
    lineHeight: 50,
    letterSpacing: -1,
    color: t.color.text.primary,
  },
  wordOn: {
    color: t.color.text.primary,
  },
});
