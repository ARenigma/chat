import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  ReduceMotion,
} from 'react-native-reanimated';
import { EASE_OUT, springTo } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import {
  SOURCE_METRICS,
  STEP_DESCRIPTION_DELAY_MS,
  STEP_EXIT_MS,
  type StepSpec,
} from '../lib/onboarding';

/** Expanded and collapsed sizes, from the source's ternaries in `Step.swift`. */
const ICON_EXPANDED = SOURCE_METRICS.iconOpen;
const ICON_COLLAPSED = SOURCE_METRICS.iconShut;
const TITLE_EXPANDED = SOURCE_METRICS.titleOpen;
const TITLE_COLLAPSED = SOURCE_METRICS.titleShut;

interface Props {
  step: StepSpec;
  expanded: boolean;
  /**
   * The active step's icon colour — the step's own wash tone, the way Fuse tints
   * each step's SF Symbol with its step colour. Only shows while expanded; a
   * collapsed row is always the muted grey. Defaults to the accent.
   */
  accent?: string;
  /**
   * Drop the leading icon entirely. Fuse's steps carry refined SF Symbols; our
   * glyphs (Lucide when this was decided) read heavier beside the title, so the
   * sign-in checklist runs icon-less — title-only — which is cleaner and more
   * coherent.
   */
  hideIcon?: boolean;
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
/*
 * Hoisted, not built in the render.
 *
 * Reanimated builders allocate on construction, so one written inline is a new
 * object on every render of every step. These live here rather than in motion.ts
 * because their duration is `STEP_EXIT_MS`, which belongs to the onboarding
 * source's own timing sheet and not to the app-wide token table.
 */
const descriptionIn = FadeInUp.duration(STEP_EXIT_MS)
  .delay(STEP_DESCRIPTION_DELAY_MS)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);
const descriptionOut = FadeOutUp.duration(STEP_EXIT_MS)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

function OnboardingStepView({ step, expanded, accent, hideIcon, testID }: Props) {
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
  /*
   * `springTo(..., 'smooth')`, and the change closes two findings with one
   * edit (2026-09-12).
   *
   * It was `withTiming(..., Easing.inOut(Easing.quad))`. That is an ease-IN
   * phase on a row the user is actively waiting to open — the one thing the
   * art-direction rule in DESIGN.md forbids outright, because an ease-in delays
   * the only part of the motion that answers the tap. It was allowlisted in
   * theme.test.ts as a KNOWN GAP rather than fixed, on the grounds that
   * onboarding had just been reverted that day. That was a reason, not a fix.
   *
   * And the allowlist's own note said what the right answer was: the source,
   * `OnboardingFlow.swift`, animates this with SwiftUI's `.smooth` — a
   * critically damped SPRING, not a cubic. `SPRING.smooth` is this app's
   * critically damped spring (ratio 1.01, per its token note). So the spring is
   * simultaneously the correct translation of the reference AND ease-out by
   * construction, because a spring has no ease-in phase to have.
   *
   * STEP_ADVANCE_MS is gone with the timing call rather than preserved as a
   * spring duration; a spring is specified by its physics, and pinning one to a
   * duration is how you get a spring that is secretly a curve.
   */
  const open = useDerivedValue(
    () => springTo(expanded ? 1 : 0, 'smooth'),
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
  /*
   * The ACTIVE row's title is the brand coral (Amit, 2026-09-13: "the active
   * step in onboarding should also be in brand coral text to highlight it").
   *
   * It was near-black. That made the checklist read as one block of type in two
   * greys, with nothing but size saying which row the member is actually being
   * asked about — on a screen whose whole structure is "these rows stay visible
   * and the live one is promoted".
   *
   * `bg/accent` — THE BRAND PEACH — and not `text/accent`, which is the small-
   * text ink. The first version used the ink and Amit's answer was immediate:
   * "again the highlighted color is more brown on active step than coral".
   *
   * He was right, and the arithmetic says why it could not have been otherwise.
   * Brown is dark-plus-orange, so LIGHTNESS is the discriminator, not hue and
   * not saturation — both of which were already correct. At this hue an ink
   * that clears 4.5:1 on white cannot go brighter than L40, and L40 is rust.
   * A 4.5:1 ink on white is structurally incapable of being a bright coral.
   *
   * The way out is that this title does not need 4.5:1. It is 42pt, which is
   * "large text" by developer.android.com/guide/topics/ui/accessibility/apps
   * ("If the text is smaller than 18sp... 4.5:1. For all other text... 3:1"),
   * so the 3:1 step applies and the bright accent qualifies at 3.08:1. That is
   * the whole reason this one piece of text may wear the fill colour when the
   * links and row labels elsewhere may not.
   *
   * A completed or upcoming row stays Fuse's `.gray` (text/muted) — receding,
   * rather than "secondary text you must still read". So the interpolation now
   * runs muted -> accent, and the promotion is a colour change as well as a
   * size change, which is what makes it read as highlighted rather than merely
   * larger.
   */
  const titleColor = useAnimatedStyle(() => ({
    color: interpolateColor(
      open.value,
      [0, 1],
      [theme.color.text.muted, theme.color.bg.accent],
    ),
  }));
  const titleOpenFade = useAnimatedStyle(() => ({ opacity: open.value }));
  const titleShutFade = useAnimatedStyle(() => ({ opacity: 1 - open.value }));

  return (
    <View testID={testID} style={expanded ? styles.rowOpen : styles.rowShut}>
      {hideIcon === true ? null : (
        <Animated.View style={[styles.iconSlot, iconScale]}>
          <Icon
            name={step.glyph}
            size={ICON_EXPANDED}
            color={theme.color.text.muted}
          />
          <Animated.View style={[styles.iconOverlay, iconOn]}>
            <Icon
              name={step.glyph}
              size={ICON_EXPANDED}
              color={accent ?? theme.color.bg.accent}
            />
          </Animated.View>
        </Animated.View>
      )}

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
            entering={descriptionIn}
            exiting={descriptionOut}
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
      // Trim the Android font-metric padding so the large bold title sits tight
      // and renders as cleanly as the source's SF display face.
      includeFontPadding: false,
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
      ...TOKENS.typography.bodyLarge,
      // Faint and airy, like the source's black.opacity(0.3): supporting copy
      // under the active step, not a second title. muted (#8E8E93) is lighter
      // than tertiary, closer to the source, and clear of pure body copy.
      color: t.color.text.muted,
    },
  });
