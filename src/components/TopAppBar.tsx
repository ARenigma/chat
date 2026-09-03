/**
 * M3 Top App Bar — small and medium-flexible variants.
 *
 * Spec: https://m3.material.io/components/app-bars/specs
 *
 * SMALL (default): a single 64 dp row — leading nav icon, start-aligned title,
 * trailing actions. Used where the screen title is secondary to its content.
 *
 * MEDIUM FLEXIBLE: the two-row expressive bar (user 2026-08-31). A 64 dp action
 * row (leading + trailing) sits above a larger headline row, so the expanded bar
 * is 112 dp (128 dp with a subtitle). On scroll it *collapses*: the large
 * headline fades and lifts away, the container shrinks to the 64 dp action row,
 * and the title cross-fades UP into that row so it is never lost. This is the
 * defining behaviour of the flexible bars — a static two-line header is a
 * medium bar that forgot to collapse.
 *
 *   Collapsed height ....... 64 dp
 *   Expanded height ........ 112 dp (headline only) / 128 dp (with subtitle)
 *   Headline (expanded) .... displaySmall, start-aligned on the lower row
 *   Title (collapsed) ...... headline, start-aligned in the action row
 *
 * Collapse is driven by a Reanimated `scrollY` shared value the caller pipes in
 * from its list's `useAnimatedScrollHandler`. Without one the bar renders
 * expanded and static (correct for a non-scrolling screen).
 *
 * Positioning: caller owns the safe area. This provides the content rows only,
 * so it drops into a SafeAreaView or a `paddingTop: insets.top` container.
 */
import React, { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

/** M3 Small Top App Bar container height (dp), excluding safe area inset. */
export const TOP_APP_BAR_HEIGHT = 64;
/** Medium flexible expanded heights (dp), excluding safe area inset. */
export const TOP_APP_BAR_MEDIUM_HEIGHT = 112;
export const TOP_APP_BAR_MEDIUM_SUBTITLE_HEIGHT = 128;
/** Scroll distance over which the medium bar collapses to the action row. */
const COLLAPSE_DISTANCE = 96;

interface Props {
  /** Navigation icon or back button. 48 dp touch target recommended. */
  leading?: ReactNode;
  /** Screen title. */
  title: string;
  /** One or two trailing icon actions. */
  trailing?: ReactNode;
  /** 'small' (single row) or 'medium' (flexible two-row, collapses on scroll). */
  variant?: 'small' | 'medium';
  /** Optional subtitle under the headline (medium only, per flexible spec). */
  subtitle?: string;
  /** List scroll offset (Reanimated). Drives the medium collapse; omit to pin expanded. */
  scrollY?: SharedValue<number>;
  /** Let a cover image carry the app-bar surface, as on profile headers. */
  transparent?: boolean;
  testID?: string;
}

function TopAppBarView({
  leading,
  title,
  trailing,
  variant = 'small',
  subtitle,
  scrollY,
  transparent = false,
  testID,
}: Props) {
  const styles = useStyles(makeStyles);

  if (variant === 'medium') {
    return (
      <MediumBar
        leading={leading}
        title={title}
        trailing={trailing}
        subtitle={subtitle}
        scrollY={scrollY}
        transparent={transparent}
        testID={testID}
      />
    );
  }

  return (
    <View
      testID={testID}
      style={[styles.bar, transparent && styles.transparent]}
      accessibilityRole="header">
      {/* Leading slot — always reserves space so the title stays centred */}
      <View style={styles.slot}>{leading ?? null}</View>

      {/* Title — start-aligned per M3 Small top app bar spec */}
      <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
        allowFontScaling
        numberOfLines={1}
        style={styles.title}
        accessibilityRole="text">
        {title}
      </Text>

      {/* Trailing slot */}
      <View style={[styles.slot, styles.trailingSlot]}>{trailing ?? null}</View>
    </View>
  );
}

function MediumBar({
  leading,
  title,
  trailing,
  subtitle,
  scrollY,
  transparent,
  testID,
}: Omit<Props, 'variant'>) {
  const styles = useStyles(makeStyles);
  const expanded = subtitle
    ? TOP_APP_BAR_MEDIUM_SUBTITLE_HEIGHT
    : TOP_APP_BAR_MEDIUM_HEIGHT;

  // Container shrinks expanded → collapsed as the list scrolls up.
  const containerStyle = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    return {
      height: interpolate(
        y,
        [0, COLLAPSE_DISTANCE],
        [expanded, TOP_APP_BAR_HEIGHT],
        Extrapolation.CLAMP,
      ),
    };
  });

  // Large headline fades and lifts away in the first 60% of the collapse.
  const headlineStyle = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    return {
      opacity: interpolate(y, [0, COLLAPSE_DISTANCE * 0.6], [1, 0], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(
            y,
            [0, COLLAPSE_DISTANCE],
            [0, -12],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  // Collapsed title cross-fades UP into the action row so the title is never lost.
  const inlineTitleStyle = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    return {
      opacity: interpolate(
        y,
        [COLLAPSE_DISTANCE * 0.55, COLLAPSE_DISTANCE],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  return (
    <Animated.View
      testID={testID}
      style={[styles.mediumHost, transparent && styles.transparent, containerStyle]}
      accessibilityRole="header">
      {/* Action row: leading + collapsed title + trailing. */}
      <View style={styles.actionRow}>
        <View style={styles.slot}>{leading ?? null}</View>
        <Animated.Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
          allowFontScaling
          numberOfLines={1}
          style={[styles.inlineTitle, inlineTitleStyle]}>
          {title}
        </Animated.Text>
        <View style={[styles.slot, styles.trailingSlot]}>{trailing ?? null}</View>
      </View>

      {/* Headline row: the large, start-aligned title (+ optional subtitle). */}
      <Animated.View style={[styles.headlineRow, headlineStyle]} pointerEvents="none">
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling numberOfLines={1} style={styles.headline}>
          {title}
        </Text>
        {subtitle ? (
          <Text allowFontScaling numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

export const TopAppBar = memo(TopAppBarView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      height: TOP_APP_BAR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space['2xs'],
      backgroundColor: t.color.bg.base,
    },
    // 48 dp slot for leading/trailing icons (M3 touch target).
    slot: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    trailingSlot: {
      marginLeft: 'auto',
    },
    title: {
      flex: 1,
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      // M3 Small: title is start-aligned (not centred).
      textAlign: 'left',
      paddingHorizontal: TOKENS.space['2xs'],
    },
    // Medium flexible bar.
    mediumHost: {
      backgroundColor: t.color.bg.base,
      overflow: 'hidden',
      justifyContent: 'flex-start',
    },
    transparent: {
      backgroundColor: 'transparent',
    },
    actionRow: {
      height: TOP_APP_BAR_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: TOKENS.space['2xs'],
    },
    inlineTitle: {
      flex: 1,
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'left',
      paddingHorizontal: TOKENS.space['2xs'],
    },
    headlineRow: {
      // Fills the space below the action row; start-aligned, bottom-anchored so
      // the headline sits close to the content it heads (M3 medium layout).
      flex: 1,
      justifyContent: 'flex-end',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.sm,
    },
    headline: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    subtitle: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
  });
