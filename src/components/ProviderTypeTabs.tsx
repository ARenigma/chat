import React, { useCallback, useEffect, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
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
/**
 * Space between the label's line box and the indicator slot: Bluesky's pager
 * tab `itemInner.paddingBottom: 10` (src/view/com/pager/TabBar.tsx:487). With
 * the 20dp `textMdSemiBold` line and the 3dp indicator that leaves 15 above the
 * label in the 48dp box: 15 + 20 + 10 + 3 = 48 (ADR-0033).
 */
const TAB_LABEL_PAD_BOTTOM = 10;
/**
 * Stated deviation from Bluesky, which leaves the tab label uncapped: its
 * TabBar is a horizontal ScrollView, so a label that grows scrolls. These tabs
 * are fixed `flex: 1` halves, so at a 200% font scale "Astrologers" would clip
 * instead. 1.5 is the cap this label carried before the type change.
 */
const TAB_LABEL_FONT_SCALE_CAP = 1.5;
const TAB_COUNT = PROVIDER_CATEGORIES.length;

/**
 * Seeds for `tabStripWidth` / `tabLabelWidths`, so the indicator is CORRECT
 * from the very first frame rather than invisible until `onLayout` fires.
 *
 * Found on the device, and it is the specific defect behind two of Amit's
 * reports at once — "type tab should be fixed in viewport and never move when
 * changing screens between home and favourites" and "there is slight
 * misalignment right now horizontally between listeners and astrologers tab".
 * Measured with a pixel scan of both screens' first frame: Home's underline was
 * a solid bar from x168 to x372; Favourites', captured at the same moment, had
 * NONE — no bar anywhere in the row. Not misaligned. Not present. The
 * `tabIndicatorStyle` worklet returns `{ width: 0, opacity: 0 }` whenever
 * `tabStripWidth.value` is still its initial 0, which it is until the strip's
 * own `onLayout` round-trips through the bridge — and `FavouritesScreen`'s
 * `ProviderTypeTabs` is a FRESH instance on the first visit (`TabLayer` mounts
 * it fresh, then crossfades it in), so that round-trip has never happened when
 * the fade starts. HomeScreen's copy is mounted at cold start, before there is
 * anything to compare it against, so the same gap is there and simply goes
 * unnoticed.
 *
 * Both numbers below are safe to hardcode rather than derive:
 *
 *   `INITIAL_STRIP_WIDTH` — the strip has no horizontal margin of its own (see
 *   `styles.tabs`) and neither screen pads its root, so the strip's true width
 *   IS the window width. `Dimensions.get('window').width` reads it
 *   synchronously, with no layout pass to wait for — the one case where reading
 *   a window dimension outside `useWindowDimensions()` is correct instead of a
 *   rotation bug, because this repo runs portrait-locked (RULE 1 §3) and the
 *   value is a same-frame seed that `onTabStripLayout` immediately supersedes,
 *   not a value anything keeps depending on.
 *
 *   `INITIAL_LABEL_WIDTHS` — measured off the Redmi at density 440 (2.75
 *   px/dp): "Listeners" 204px = 74dp, "Astrologers" 259px = 94dp. A font-scale
 *   setting other than 100% will measure differently, and `onTabLabelLayout`
 *   corrects it on the very next frame either way — this is a seed for frame
 *   one, not a value the indicator is stuck with.
 */
const INITIAL_STRIP_WIDTH = Dimensions.get('window').width;
const INITIAL_LABEL_WIDTHS: Record<ProviderCategory, number> = {
  listener: 74,
  astrologer: 94,
};

interface Props {
  value: ProviderCategory;
  onChange: (category: ProviderCategory) => void;
  testID?: string;
}

export function ProviderTypeTabs({ value, onChange, testID = 'provider-type-tabs' }: Props) {
  const styles = useStyles(makeStyles);

  const tabIndex = PROVIDER_CATEGORIES.indexOf(value);
  const tabStripWidth = useSharedValue(INITIAL_STRIP_WIDTH);
  const tabLabelWidths = useSharedValue<number[]>(
    PROVIDER_CATEGORIES.map(c => INITIAL_LABEL_WIDTHS[c]),
  );
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
  // Seeded to match `tabLabelWidths`'s own initial value, not zero — otherwise
  // the very first real `onLayout` (measuring the same width the seed already
  // guessed) would look like a change from 0 and write a redundant update. Not
  // a correctness bug either way, but a ref that starts out disagreeing with
  // the shared value it exists to mirror is the kind of thing that goes wrong
  // when someone runs the diff test asymmetrically instead of top-to-bottom.
  const labelWidths = useRef<number[]>(
    PROVIDER_CATEGORIES.map(c => INITIAL_LABEL_WIDTHS[c]),
  );
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
              maxFontSizeMultiplier={TAB_LABEL_FONT_SCALE_CAP}
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
      paddingBottom: TAB_INDICATOR_HEIGHT + TAB_LABEL_PAD_BOTTOM,
    },
    // Bluesky pager tab label: text_md font_semi_bold on a 20 line
    // (TabBar.tsx:448, :492).
    tabLabel: {
      ...TOKENS.typography.textMdSemiBold,
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
