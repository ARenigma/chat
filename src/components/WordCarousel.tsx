import React, { memo, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { carouselSlot } from '../lib/carousel';
import { DURATION, OPACITY, carouselLoop } from '../theme/motion';
import { Icon } from './Icon';

interface Props {
  /** Three, in the order they should be said. Two works; one renders statically. */
  words: readonly string[];
  testID?: string;
}

/**
 * Rule 1 of the Fuse motion system: three claims in one screen's worth of space,
 * with no pager and no dots.
 *
 * All three lines are on screen the whole time. One is lit and the other two sit
 * ============================================================================
 * NOT CURRENTLY RENDERED ANYWHERE, and that is deliberate rather than an
 * oversight. Read this before wiring it to anything.
 *
 * It shipped once on the sign-in screen, driving three product claims, and was
 * reverted after being watched on a device. The reason is arithmetic, not taste:
 * `text/secondary` is 7.41:1 on white and composites to 1.16:1 at the 10% alpha
 * below. It does not reach AA's 4.5:1 until alpha 0.85, and at 0.85 the fade is
 * imperceptible, so the effect and the legibility cannot both exist at body
 * size. One of those three claims was "Not therapy, just company", which is this
 * product's ethical position and the last line that should ever be a flourish.
 *
 * So the rule holds only for content that is DECORATION. In the Fuse reference it
 * cycles single words inside a headline at display size, where each variant is a
 * complete thought and nothing is hidden. That is the one home worth giving this,
 * and it needs headline copy somebody chooses on purpose. Until then it stays
 * unused rather than deleted, because the component is correct: the screen-reader
 * gating, the reduce-motion path and the cadence are all tested.
 * ============================================================================
 *
 * at 10% opacity (present as shape, unreadable as information), and the focus
 * advances on its own about every 1.1s. That is what makes it a device for saying
 * three things rather than a slideshow of one: you can see there is more without
 * being asked to wait for it.
 *
 * **Every row's loop is built once and left alone on the UI thread.** No
 * `setInterval`, no state per tick, no re-render. That is not an optimisation, it
 * is the behaviour: this sits on the sign-in screen, and the sign-in screen hands
 * off to the system browser for Google OAuth. A JS-driven carousel stalls the
 * moment the thread is busy and then jumps several words when it comes back. The
 * reference records the same property as "keeps running behind a presented
 * modal"; we present nothing over this screen, but we do lose the thread.
 *
 * **Accessibility is the interesting part, and it is not free.** At 10% opacity a
 * neighbour fails every contrast threshold that exists, which is fine for a
 * decoration and not fine for a screen reader: TalkBack would happily read all
 * three overlapping slogans in whatever order they are mounted. So the animated
 * rows are hidden from the tree entirely and the host carries one label with all
 * three claims as a sentence. Nothing is lost and nothing is read twice.
 *
 * **Reduced motion stops it dead rather than slowing it down.** One word, static,
 * full opacity, and the loop is never started. See `carouselLoop` for why a
 * short-circuited infinite repeat is a busy loop rather than a stopped animation.
 */
function WordCarouselView({ words, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reduced = useReducedMotion();
  const looping = !reduced && words.length > 1;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      // One label for the whole device. The rows below are hidden, so this is the
      // only thing read, and it says all three claims once.
      accessibilityLabel={words.join('. ')}
      style={styles.host}>
      {(looping ? words : words.slice(0, 1)).map((word, index) => (
        <Row
          // Index in the key as well as the word: two identical claims would
          // otherwise collapse into one row and take the other one's phase.
          key={`${index}-${word}`}
          word={word}
          index={index}
          count={words.length}
          looping={looping}
          markColor={theme.color.text.primary}
        />
      ))}
    </View>
  );
}

export const WordCarousel = memo(WordCarouselView);

/**
 * One line, and its own animation.
 *
 * Split out so the shared value and the effect are per row rather than an array
 * of them: a hook cannot be called in a loop, and an array of shared values
 * driven from one effect is the same thing with more places to get the index
 * wrong.
 */
function Row({
  word,
  index,
  count,
  looping,
  markColor,
}: {
  word: string;
  index: number;
  count: number;
  looping: boolean;
  markColor: string;
}) {
  const styles = useStyles(makeStyles);
  // Starts lit for row 0 and dim for the rest, so the first frame is already the
  // resting state rather than a flash of three equal lines.
  const opacity = useSharedValue(index === 0 || !looping ? 1 : OPACITY.neighbour);
  const slot = useMemo(
    () => carouselSlot(index, count, DURATION.carouselDwell, DURATION.base, OPACITY.neighbour),
    [index, count],
  );

  useEffect(() => {
    if (!looping) {
      return;
    }
    opacity.value = carouselLoop(slot);
    // Nothing cancels it. A shared value's animation is replaced by the next
    // assignment and torn down with the view, and there is no cleanup call that
    // would do anything a remount does not already do.
  }, [looping, opacity, slot]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // The mark rides the row rather than sitting in a fixed column, so it fades
  // with the word it belongs to and there is never a lit mark beside a dim line.
  return (
    <Animated.View
      style={[styles.row, animated]}
      // Hidden from the reader in both directions: `accessible={false}` stops the
      // row becoming a focus target, and the Android-only prop stops the Text
      // inside it becoming one either. Both are needed: the first alone leaves
      // TalkBack reading the descendants.
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Icon name="dot" size={TOKENS.space.sm} color={markColor} />
      <Text allowFontScaling numberOfLines={1} style={styles.word}>
        {word}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    gap: TOKENS.space['2xs'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  // One type style for all three rows, and the same one whether a row is focused
  // or not. The reference gives its focused word more weight; here that would
  // reflow the line on the frame the focus changes while the opacity is still
  // travelling, and rule 7 is explicit that nothing scales text.
  word: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
    flexShrink: 1,
  },
});
