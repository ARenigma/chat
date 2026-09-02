import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { SOURCE_METRICS, STEP_ADVANCE_MS, STEP_EXIT_MS, type StepSpec } from '../lib/onboarding';

/** Expanded and collapsed sizes, from the source's ternaries in `Step.swift`. */
const ICON_EXPANDED = SOURCE_METRICS.iconOpen;
const ICON_COLLAPSED = SOURCE_METRICS.iconShut;
const TITLE_EXPANDED = SOURCE_METRICS.titleOpen;
const TITLE_COLLAPSED = SOURCE_METRICS.titleShut;

interface Props {
  step: StepSpec;
  expanded: boolean;
  testID?: string;
}

/**
 * One row of the checklist, which is either the question being asked or a line
 * in the list of ones already answered.
 *
 * **A collapsed step is not a hidden step.** The source keeps every row on
 * screen the whole time and changes its layout: expanded it is a `VStack` with a
 * 32pt coloured icon, a 42pt black title and a description; collapsed it is an
 * `HStack` with a 20pt grey icon and a 24pt grey title and nothing else. The
 * list of finished steps staying visible above the current one is what makes the
 * flow read as progress through a single thing rather than as a series of
 * screens, and it is the reason none of this needs a progress bar.
 *
 * **SwiftUI can interpolate between two layouts and React Native cannot.** The
 * source writes `AnyLayout(VStackLayout(...))` against `AnyLayout(HStackLayout(...))`
 * and gets a continuous morph for free. `flexDirection` is not an animatable
 * property here, so the direction switches discretely and everything that CAN be
 * interpolated — both sizes, both colours, the description's entry — is driven
 * off one shared progress value so the switch lands inside a movement rather
 * than standing alone as a jump.
 */
function OnboardingStepView({ step, expanded, testID }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  /*
   * One value drives every interpolation in the row.
   *
   * Deriving it rather than holding a `useSharedValue` and writing to it in an
   * effect means the row cannot get stuck part-open if `expanded` changes twice
   * inside one frame, which is exactly what happens when a step both completes
   * and advances in the same tick.
   */
  const open = useDerivedValue(
    () =>
      withTiming(expanded ? 1 : 0, {
        duration: STEP_ADVANCE_MS,
        easing: Easing.inOut(Easing.quad),
      }),
    [expanded],
  );

  const iconScale = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(
          open.value,
          [0, 1],
          [ICON_COLLAPSED / ICON_EXPANDED, 1],
        ),
      },
    ],
  }));

  // The icon's colour change is a cross-fade rather than an interpolation,
  // because `Icon` draws with borders and takes its colour as a prop, so there
  // is no single animatable colour to drive.
  const iconOn = useAnimatedStyle(() => ({ opacity: open.value }));

  /*
   * Two titles at two fixed sizes, cross-faded — never one title with an
   * animated `fontSize`.
   *
   * The first version interpolated `fontSize` and `lineHeight` on a single
   * `Animated.Text`. Both are layout properties, so every frame of the 500ms
   * promotion forced a text re-measure and a layout pass on the JS-adjacent
   * path, and on the onboarding handoff that ran on top of the field's three
   * layers cross-fading. Opacity is composited on the UI thread and costs
   * nothing to lay out. This is also what `design/references/motion-system.md`
   * rule 7 asks for: text swaps are opacity only, nothing scales a glyph.
   *
   * The in-flow title is the one for the CURRENT `expanded` state, so the row's
   * height switches at the same instant `flexDirection` already does; the other
   * is absolutely positioned over it and fades out.
   */
  const titleColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      open.value,
      [0, 1],
      [theme.color.text.tertiary, theme.color.text.primary],
    ),
  }));
  const titleOpenFade = useAnimatedStyle(() => ({ opacity: open.value }));
  const titleShutFade = useAnimatedStyle(() => ({ opacity: 1 - open.value }));

  return (
    <View testID={testID} style={expanded ? styles.rowOpen : styles.rowShut}>
      <Animated.View style={[styles.iconSlot, iconScale]}>
        <Icon
          name={step.glyph}
          size={ICON_EXPANDED}
          color={theme.color.text.tertiary}
        />
        <Animated.View style={[styles.iconOverlay, iconOn]}>
          <Icon
            name={step.glyph}
            size={ICON_EXPANDED}
            color={theme.color.bg.accent}
          />
        </Animated.View>
      </Animated.View>

      <View style={expanded ? styles.bodyOpen : styles.bodyShut}>
        <View style={styles.titleStack}>
          <Animated.Text
            allowFontScaling
            numberOfLines={2}
            style={[
              styles.title,
              styles.titleOpen,
              expanded ? styles.titleInFlow : styles.titleOverlay,
              titleColor,
              titleOpenFade,
            ]}
          >
            {step.title}
          </Animated.Text>
          <Animated.Text
            allowFontScaling
            numberOfLines={2}
            style={[
              styles.title,
              styles.titleShut,
              expanded ? styles.titleOverlay : styles.titleInFlow,
              titleColor,
              titleShutFade,
            ]}
          >
            {step.title}
          </Animated.Text>
        </View>

        {/*
         * The description exists only while expanded, rather than being faded to
         * zero, because a zero-opacity paragraph still occupies its height and
         * the collapsed rows have to close up against each other. The source's
         * asymmetric transition is preserved:
         *   insertion .offset(y: 30) + .opacity  -> FadeInUp
         *   removal   .offset(y: -60) + .opacity -> FadeOutUp
         * It arrives from BELOW and leaves UPWARD, so a step being answered
         * pushes its description out of the way rather than dissolving where it
         * stands. Both are presets rather than hand-built: `withInitialValues`
         * is typed per-animation, so `FadeIn` accepts an opacity and nothing
         * else, and it sets where an exit STARTS rather than where it ends.
         */}
        {expanded ? (
          <Animated.View
            // Source: `.smooth(duration: 0.2)` on both insertion and removal.
            entering={FadeInUp.duration(STEP_EXIT_MS).delay(80)}
            exiting={FadeOutUp.duration(STEP_EXIT_MS)}
          >
            <Animated.Text allowFontScaling style={styles.description}>
              {step.description}
            </Animated.Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

export const OnboardingStep = memo(OnboardingStepView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // The source's `VStackLayout(alignment: .leading, spacing: 12)`.
    rowOpen: {
      flexDirection: 'column',
      gap: SOURCE_METRICS.stepOpenGap,
    },
    // The source's `HStackLayout(spacing: 24)`. Not `space.lg`, which is 20: this
    // is a measured value and rounding it to the nearest token changes the layout.
    rowShut: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SOURCE_METRICS.stepShutGap,
    },
    /*
     * Fixed at the EXPANDED size and scaled down, never resized.
     *
     * `Icon` draws with borders whose widths derive from `size`, so re-rendering
     * it at a new size every frame would both thrash the JS thread and change
     * stroke weight discontinuously. A transform is free, stays on the UI thread,
     * and scales the strokes with the glyph the way the reference's SF Symbol
     * does.
     */
    iconSlot: {
      width: ICON_EXPANDED,
      height: ICON_EXPANDED,
    },
    iconOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    /*
     * `flex: 1` belongs to the COLLAPSED row only, and the difference is not
     * cosmetic.
     *
     * Collapsed, the row is horizontal and `flex: 1` is what makes the title take
     * the width left over beside the icon. Expanded, the row is vertical, and the
     * same declaration means "take all remaining HEIGHT" inside a parent that is
     * hugging its content — so it resolves to zero and the title, the description
     * and the control all vanish while the icon stays. That is exactly what
     * shipped to the emulator: one coral outline and an off-screen button.
     *
     * One property, opposite meanings, decided by an axis set three lines away.
     */
    bodyOpen: {
      alignSelf: 'stretch',
      gap: SOURCE_METRICS.stepOpenGap,
    },
    bodyShut: {
      flex: 1,
      gap: SOURCE_METRICS.stepOpenGap,
    },
    // Step.swift applies `.bold()` at both 42pt and 24pt; use the bundled static
    // face directly so Android does not synthesise a heavier face.
    title: {
      fontFamily: 'Geist-Bold',
      letterSpacing: -0.5,
    },
    // The two fixed sizes the row cross-fades between (the source's ternary
    // `isExpanded ? 42 : 24`). Leading is set per size, not animated.
    titleOpen: {
      fontSize: TITLE_EXPANDED,
      lineHeight: TITLE_EXPANDED * 1.1,
    },
    titleShut: {
      fontSize: TITLE_COLLAPSED,
      lineHeight: TITLE_COLLAPSED * 1.25,
    },
    titleStack: {
      alignSelf: 'stretch',
    },
    titleInFlow: {
      position: 'relative',
    },
    titleOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    },
    description: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
  });
