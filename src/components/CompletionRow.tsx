import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION, springTo } from '../theme/motion';
import { Icon } from './Icon';
import { LoadingIndicator } from './LoadingIndicator';
import {
  COMPLETION_HOLD_MS,
  COMPLETION_WORK_MS,
  SOURCE_METRICS,
  STEP_ADVANCE_MS,
} from '../lib/onboarding';

interface Props {
  /** Called once the completed state has been held long enough to be read. */
  onDone: () => void;
  testID?: string;
}

/**
 * The last row of the checklist: working, then done.
 *
 * This is `CompletionStep.swift`, and the first build of this screen skipped it
 * entirely — a static check mark appeared the instant sign-in returned. That is
 * the difference between a flow that ends and a flow that just stops. The
 * reference spends two full seconds here on purpose: a mark that resolves before
 * anything could plausibly have happened reads as decoration rather than as a
 * result.
 *
 * **Two deliberate departures from the source, both because this app already
 * decided the question.**
 *
 * The source spins a dashed circle: `circle.dashed` under a `rotationEffect`
 * repeating forever. This app's busy idiom is `Spinner`, the eight-spoke iOS
 * activity indicator, and its own documentation is explicit that nothing
 * rotates — a rotating transform on eight children costs more per frame than
 * eight opacity writes, and a real indicator steps from spoke to spoke rather
 * than sweeping. Same information, this app's vocabulary. Introducing a second,
 * rotating busy indicator for one row would be the departure, not this.
 *
 * The colour of the finished mark is the accent, not the source's green. Green
 * appears nowhere in this product's palette; `state/positive` exists but is a
 * background tint for a positive surface, not a foreground mark. The accent is
 * what this app uses to mean "this is the live thing", which is exactly what the
 * completed row is.
 *
 * **The overshoot is the source's** — `.bouncy(duration: 1)` — and it is the
 * second and last place `bounce` is used here. See the note in `motion.ts`.
 */
function CompletionRowView({ onDone, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);

  /*
   * Scale, driven once when the mark resolves.
   *
   * Starts below 1 so the spring has something to overshoot from. The source's
   * `.transition(.scale)` on an `.id`-swapped view is the same gesture: the old
   * mark leaves and the new one arrives at a different size.
   */
  const pop = useSharedValue(0.6);

  useEffect(() => {
    const finish = setTimeout(() => {
      setDone(true);
      /*
       * `springTo`, not `withSpring`: this app keeps every spring constant in
       * `motion.ts` and a test fails on a direct call, so a one-off overshoot
       * cannot drift away from the token that defines it.
       */
      pop.value = reduced ? 1 : springTo(1, 'bounce');
    }, COMPLETION_WORK_MS);
    return () => clearTimeout(finish);
  }, [pop, reduced]);

  useEffect(() => {
    if (!done) {
      return;
    }
    const leave = setTimeout(onDone, COMPLETION_HOLD_MS);
    return () => clearTimeout(leave);
  }, [done, onDone]);

  const mark = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.markSlot}>
        {done ? (
          <Animated.View style={mark}>
            <Icon
              name="check"
              size={SOURCE_METRICS.doneIcon}
              color={theme.color.bg.accent}
            />
          </Animated.View>
        ) : (
          <LoadingIndicator
              size={SOURCE_METRICS.doneIcon}
              color={theme.color.text.tertiary}
              containerColor="transparent"
            />
        )}
      </View>

      {/*
        * Keyed on `done`, so React replaces the text rather than mutating it.
        * That is what the source's `.id(isCompleted)` does, and it is what makes
        * the entering transition run at all — without a key change the same node
        * survives and simply shows different characters.
        */}
      <View style={styles.body}>
        <Animated.Text
          key={`title-${String(done)}`}
          entering={reduced ? undefined : FadeIn.duration(STEP_ADVANCE_MS)}
          allowFontScaling
          style={styles.title}>
          {done ? 'You’re in' : 'Setting you up'}
        </Animated.Text>
        <Animated.Text
          key={`text-${String(done)}`}
          /*
           * The second line trails the first by one `instant`, so the pair reads
           * as a headline and its subtitle rather than as two things appearing
           * at once. A token rather than a literal: this app keeps every
           * duration in `motion.ts` and a test fails on a raw millisecond.
           */
          entering={
            reduced
              ? undefined
              : FadeIn.duration(STEP_ADVANCE_MS).delay(DURATION.instant)
          }
          allowFontScaling
          style={styles.text}>
          {done
            ? 'Someone is around whenever you are.'
            : 'Getting your account ready.'}
        </Animated.Text>
      </View>
    </View>
  );
}

export const CompletionRow = memo(CompletionRowView);

const makeStyles = (t: Theme) => StyleSheet.create({
  // `HStack(alignment: .top, spacing: 24)`.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SOURCE_METRICS.doneGap,
  },
  /*
   * Fixed slot, so the spinner and the check occupy identical space. Without it
   * the row's text shifts sideways at the exact moment the mark resolves, which
   * is the one moment nothing else should move.
   */
  markSlot: {
    width: SOURCE_METRICS.doneIcon,
    height: SOURCE_METRICS.doneIcon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `VStack(alignment: .leading, spacing: 12)`.
  body: {
    flex: 1,
    gap: SOURCE_METRICS.doneBodyGap,
  },
  // 24pt, from `.font(.system(size: 24)).bold()`. Deliberately smaller than a
  // step title: the flow is over, and shouting the result would make it the
  // loudest thing on a screen that is now calm.
  title: {
    ...TOKENS.typography.displayLarge,
    fontSize: SOURCE_METRICS.doneTitle,
    lineHeight: Math.round(SOURCE_METRICS.doneTitle * 1.2),
    color: t.color.text.primary,
  },
  text: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
});
