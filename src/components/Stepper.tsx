import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { OPACITY, accentTo, promoteTo } from '../theme/motion';
import { Icon } from './Icon';

/** The disc. 14 reads at a glance without competing with the label beside it. */
const MARKER = 14;

interface Props {
  /** Short labels, in order. Three is what the row is designed for. */
  steps: readonly string[];
  /** Index of the step being worked on. */
  active: number;
  testID?: string;
}

/**
 * Rules 2 and 4 of the Fuse motion system: a stepper that stays, and an accent
 * that moves up a ramp as you go.
 *
 * All three steps are on screen throughout, which is the point. A progress bar
 * says how far, a stepper says what is coming, and somebody deciding whether to
 * apply to listen to strangers for money deserves the second one.
 *
 * **Rule 2, reinterpreted rather than copied.** Fuse cycles blue then orange then
 * purple, interpolating through a visibly desaturated midpoint. Our palette is
 * coral-only by settled decision, so cross-fading coral to coral would be
 * nothing at all. What transfers is the ramp: `border/strong` grey, then the
 * bright coral, then the deep one, interpolated in RGB, and the midpoints of
 * that really are desaturated mid-corals, so the mechanism survives the palette
 * change intact. Measured against both page colours before committing to it:
 * 1.68:1, 3.44:1 and 5.19:1 on white and 6.11:1 on black, so every state clears
 * the 3:1 minimum for a non-text shape. `bg/accentTint` is deliberately not the
 * first rung of that ramp despite looking like it should be: it measures 1.22:1
 * on white, the same failure the tokens file already records for the citrus.
 *
 * **This is why the file is on the accent allowlist in theme.test.ts.** The rule
 * there is actions and states only, and an active step is a state: the same
 * category as an unread count or a typing indicator, and unlike a page, a header
 * or a divider. It is also the only accent on the screen, so the budget is spent
 * once and on the thing that is actually changing.
 *
 * **Rule 4, with one deliberate deviation and one deletion.** The deviation:
 * every label uses one type style, and promotion is carried by opacity plus the
 * marker glyph. The reference gives its active step larger type, and swapping a
 * type style reflows the row on the frame the state changes while the opacity is
 * still travelling, so the label jumps, then fades, and rule 7 says nothing
 * scales text. The deletion: the reference has four marker states and one of them
 * is an in-progress spinner ring. Nothing here is ever mid-step:
 * `useSubmitApplication` is a single mutation at the very end, so a spinner
 * state would be a glyph that can never appear. The CTA narrates the submit
 * instead, which is rule 5.
 *
 * Markers are distinct SHAPES and not only colours, which the reference is
 * explicit about and which also happens to be the only way the row works for
 * anyone who cannot separate grey from coral: pending is a ring, active is a
 * filled disc, complete is a filled disc with a tick in it.
 */
function StepperView({ steps, active, testID }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <View
      testID={testID}
      // The row is one thing to a screen reader, not three unlabelled marks, and
      // the opacity that carries promotion for the eye carries nothing at all
      // here. No `accessibilityRole`: progressbar is the tempting one and it maps
      // to Android's ProgressBar widget with no iOS trait behind it, which is the
      // same reason the typing indicator dropped its role. The sentence says it.
      accessible
      accessibilityLabel={`Step ${Math.min(active + 1, steps.length)} of ${steps.length}, ${
        steps[active] ?? ''
      }`}
      style={styles.host}>
      {steps.map((label, index) => (
        <Step
          key={label}
          label={label}
          // 0 pending, 1 active, 2 complete. A number rather than three booleans
          // because it is the input to the colour ramp: one shared value walks
          // it, and interpolateColor turns it into the ramp's three stops.
          phase={index === active ? 1 : index < active ? 2 : 0}
        />
      ))}
    </View>
  );
}

export const Stepper = memo(StepperView);

function Step({ label, phase }: { label: string; phase: number }) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const active = phase === 1;
  const complete = phase === 2;

  /**
   * The ramp position, on a shared value rather than computed in the style body.
   *
   * This is the one place the two Reanimated idioms cannot be mixed. Returning an
   * animation straight out of `useAnimatedStyle` works and is what `promoted`
   * below does, but `accentTo(phase)` returns an animation OBJECT, and feeding
   * that to `interpolateColor` hands a descriptor to something expecting a
   * number. TypeScript does not catch it (the animation helpers are typed as
   * returning the value they animate) and neither would any test here: it renders
   * a broken colour on a device and nothing else. So the animation drives a value
   * and the interpolation reads it.
   */
  const walked = useSharedValue(phase);
  useEffect(() => {
    walked.value = accentTo(phase);
  }, [phase, walked]);

  // Two durations on purpose, and the difference is the rule: the label lands in
  // 150ms, the colour behind it takes 220ms to arrive.
  const marker = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      walked.value,
      [0, 1, 2],
      [
        // The accent at zero alpha, not the keyword `transparent`. Nothing
        // premultiplies for us, so interpolating from transparent BLACK to a
        // coral runs the fill through grey on the way up and the disc looks dirty
        // for 220ms. Same hue, rising alpha, no smear.
        `${theme.color.bg.accent}00`,
        theme.color.bg.accent,
        theme.color.bg.accentStrong,
      ],
    ),
    borderColor: interpolateColor(
      walked.value,
      [0, 1, 2],
      [theme.color.border.strong, theme.color.bg.accent, theme.color.bg.accentStrong],
    ),
  }));

  // Returned straight from the style body, which is the idiom that DOES work: an
  // animation returned as a style value is applied as one.
  const promoted = useAnimatedStyle(() => ({ opacity: promoteTo(phase === 1) }));

  return (
    <View style={styles.step}>
      <Animated.View style={[styles.marker, marker]}>
        {complete ? (
          <Icon name="check" size={MARKER - 4} color={theme.color.text.onAccent} />
        ) : null}
      </Animated.View>
      <Animated.Text
        allowFontScaling
        numberOfLines={1}
        style={[styles.label, active && styles.labelActive, promoted]}>
        {label}
      </Animated.Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    // Fixed, so no marker or label state can change the row's height and shove
    // the form below it. The stepper persisting is rule 4's whole claim, and a
    // stepper that resizes is not persisting.
    height: 24,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    flexShrink: 1,
  },
  marker: {
    width: MARKER,
    height: MARKER,
    borderRadius: MARKER / 2,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.secondary,
    flexShrink: 1,
    // The resting opacity, so the first frame is the settled state rather than
    // three equal labels that then demote.
    opacity: OPACITY.inactive,
  },
  labelActive: {
    color: t.color.text.primary,
  },
});
