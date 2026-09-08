import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { tabIndicatorLead, tabIndicatorTo, tabIndicatorTrail } from '../theme/motion';
import {
  CATEGORY_LABEL,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
} from '../lib/providerFilters';
import { Pressable } from './Pressable';

/**
 * The Listener / Astrologer type strip, factored out of HomeScreen on
 * 2026-09-08 so Favourites could carry the same tabs (Amit: "favourites should
 * also have type tabs at top") without a second hand-built copy of an elastic
 * M3 tab indicator.
 *
 * Everything below is unchanged from the original — the measured label widths,
 * the `ElasticTabIndicatorInterpolator` re-expression, the ripple departure —
 * only moved. See the git history on HomeScreen.tsx for the citations this was
 * built against; they are kept here rather than duplicated in two files.
 */

const TAB_INDICATOR_HEIGHT = 3;
const TAB_INDICATOR_MIN_WIDTH = 24;
const TAB_COUNT = PROVIDER_CATEGORIES.length;

interface Props {
  value: ProviderCategory;
  onChange: (category: ProviderCategory) => void;
  testID?: string;
}

export function ProviderTypeTabs({ value, onChange, testID = 'provider-type-tabs' }: Props) {
  const styles = useStyles(makeStyles);

  const tabIndex = PROVIDER_CATEGORIES.indexOf(value);
  const tabStripWidth = useSharedValue(0);
  const tabLabelWidths = useSharedValue<number[]>(PROVIDER_CATEGORIES.map(() => 0));
  const tabOrigin = useSharedValue(tabIndex);
  const tabTarget = useSharedValue(tabIndex);
  const tabSlide = useSharedValue(tabIndex);
  useEffect(() => {
    tabOrigin.value = tabTarget.value;
    tabTarget.value = tabIndex;
    tabSlide.value = tabIndicatorTo(tabIndex);
  }, [tabIndex, tabOrigin, tabTarget, tabSlide]);

  const onTabStripLayout = useCallback(
    (width: number) => {
      tabStripWidth.value = width;
    },
    [tabStripWidth],
  );
  const labelWidths = useRef<number[]>(PROVIDER_CATEGORIES.map(() => 0));
  const onTabLabelLayout = useCallback(
    (index: number, width: number) => {
      if (labelWidths.current[index] === width) {
        return;
      }
      labelWidths.current = labelWidths.current.map((w, i) => (i === index ? width : w));
      tabLabelWidths.value = labelWidths.current;
    },
    [tabLabelWidths],
  );

  const tabIndicatorStyle = useAnimatedStyle(() => {
    const slot = tabStripWidth.value / TAB_COUNT;
    if (slot <= 0) {
      return { width: 0, opacity: 0, transform: [{ translateX: 0 }] };
    }
    const widths = tabLabelWidths.value;
    const edgesOf = (index: number) => {
      const label = Math.max(widths[index] ?? 0, TAB_INDICATOR_MIN_WIDTH);
      const centre = (index + 0.5) * slot;
      return { left: centre - label / 2, right: centre + label / 2 };
    };
    const from = edgesOf(tabOrigin.value);
    const to = edgesOf(tabTarget.value);
    const span = tabTarget.value - tabOrigin.value;
    const fraction = span === 0 ? 1 : (tabSlide.value - tabOrigin.value) / span;
    const movingRight = to.left > from.left;
    const leftFraction = movingRight ? tabIndicatorTrail(fraction) : tabIndicatorLead(fraction);
    const rightFraction = movingRight ? tabIndicatorLead(fraction) : tabIndicatorTrail(fraction);
    const left = from.left + (to.left - from.left) * leftFraction;
    const right = from.right + (to.right - from.right) * rightFraction;
    return {
      width: Math.max(right - left, 0),
      opacity: 1,
      transform: [{ translateX: left }],
    };
  });

  return (
    <View
      style={styles.tabs}
      testID={testID}
      onLayout={e => onTabStripLayout(e.nativeEvent.layout.width)}>
      {PROVIDER_CATEGORIES.map((c, index) => {
        const on = c === value;
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            testID={`${testID}-${c}`}
            accessibilityRole="tab"
            checked={on}
            accessibilityLabel={CATEGORY_LABEL[c]}
            press="none"
            highlight="ripple"
            style={styles.tab}>
            <Text
              maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
              allowFontScaling
              onLayout={e => onTabLabelLayout(index, e.nativeEvent.layout.width)}
              style={[styles.tabLabel, on && styles.tabLabelOn]}>
              {CATEGORY_LABEL[c]}
            </Text>
          </Pressable>
        );
      })}
      <Animated.View pointerEvents="none" style={[styles.tabIndicator, tabIndicatorStyle]} />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    tabs: {
      flexDirection: 'row',
      marginBottom: TOKENS.space.sm,
    },
    tab: {
      flex: 1,
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: TAB_INDICATOR_HEIGHT + TOKENS.space['2xs'],
    },
    tabLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.tertiary,
    },
    // Accent, not `text.primary` — see HomeScreen's original note on this rule
    // (Amit: "type title should highlight when selected on top otherwise hard
    // to spot types are even there"). Already a checked pair against bg/base.
    tabLabelOn: {
      color: t.color.text.accent,
    },
    tabIndicator: {
      position: 'absolute',
      left: 0,
      bottom: 0,
      height: TAB_INDICATOR_HEIGHT,
      borderTopLeftRadius: TAB_INDICATOR_HEIGHT,
      borderTopRightRadius: TAB_INDICATOR_HEIGHT,
      backgroundColor: t.color.bg.accent,
    },
  });
