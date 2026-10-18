import React, { useCallback, useRef } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import {
  CATEGORY_LABEL,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
} from '../lib/providerFilters';
import { Pressable } from './Pressable';
import { emitSoftReset } from '../lib/events';

/**
 * The Listener / Astrologer type strip, shared by Home and Favourites
 * (factored out of HomeScreen on 2026-09-08).
 *
 * SINCE 2026-09-27 IT IS A PAGER'S TAB BAR (owner decision, Amit: switching
 * categories follows Bluesky's mechanics exactly). It no longer owns any motion
 * of its own. Everything that moves reads ONE shared value, `progress`, which
 * `ProviderPager` writes on the UI thread as `position + offset` for every
 * frame of a drag or of a tapped page scroll — 0 is Listeners, 1 is
 * Astrologers, 0.5 is a finger halfway between. This is Bluesky's
 * `src/view/com/pager/TabBar.tsx`, whose indicator and item styles are both
 * `interpolate(dragProgress.get(), …)`.
 *
 * What that replaced, and why it had to go rather than sit alongside: a 500ms
 * `withTiming` toward the tapped index with M3's elastic lead/trail edges. A
 * timer cannot follow a finger; with the page under it now draggable, a
 * separately-timed indicator would either lag the content or run ahead of it.
 * One source means the indicator can never disagree with the page.
 *
 * A tap does not move anything here directly: it calls `onSelect`, the screen
 * asks the pager to scroll, and the pager's own scroll events move the
 * indicator — Bluesky's `onTabBarSelect` → `pagerView.setPage(index)`.
 *
 * NO JS WORK PER FRAME. `progress` is only ever read inside `useAnimatedStyle`
 * worklets, so React does not re-render this strip while a page moves. The
 * settled category (`value`) changes once per page change, from
 * `onPageSelected`, and drives only `checked` for TalkBack.
 */

/**
 * Bluesky's pager tab (src/view/com/pager/TabBar.tsx): each item reserves a 3dp
 * transparent bottom border as the indicator's slot (`itemInner`), and the
 * shared indicator drawn in it is a 2dp line (`borderBottomWidth: 2`), square,
 * at least 45 wide (`minIndicatorWidth = 45`) and otherwise the label's width.
 */
const TAB_INDICATOR_SLOT = 3;
const TAB_INDICATOR_HEIGHT = 2;
const TAB_INDICATOR_MIN_WIDTH = 45;
/**
 * Space between the label's line box and the indicator slot: Bluesky's pager
 * tab `itemInner.paddingBottom: 10`. With the 20dp `textMdSemiBold` line and
 * the 3dp slot that leaves 15 above the label in the 48dp box:
 * 15 + 20 + 10 + 3 = 48 (ADR-0033).
 */
const TAB_LABEL_PAD_BOTTOM = 10;
/**
 * Stated deviation from Bluesky, which leaves the tab label uncapped: its
 * TabBar is a horizontal ScrollView, so a label that grows scrolls. These tabs
 * are fixed `flex: 1` halves, so at a 200% font scale "Astrologers" would clip
 * instead. 1.5 is the cap this label carried before the type change.
 */
const TAB_LABEL_FONT_SCALE_CAP = 1.5;
/** The page coordinate of each tab: `interpolate`'s input range. */
const TAB_INDICES = PROVIDER_CATEGORIES.map((_, i) => i);

/**
 * Seeds for `tabStripWidth` / `tabLabelWidths`, so the indicator is CORRECT
 * from the very first frame rather than invisible until `onLayout` fires.
 *
 * Found on the device (2026-09-08): Favourites' copy of this strip is a FRESH
 * instance on the first visit, and with zero seeds the indicator worklet had
 * nothing to draw until the strip's own `onLayout` round-tripped — a pixel scan
 * of its first frame found no underline anywhere in the row.
 *
 * Kept under react-navigation (nav-migration §5, step 8) for the navigator's
 * reason: the bottom tabs are `lazy`, so Favourites still mounts this strip
 * fresh on its first visit, and a detached tab's first layout has not been
 * measured on the S22 yet. Delete both seeds only once a device frame shows
 * the underline correct on that first visit without them.
 *
 *   `INITIAL_STRIP_WIDTH` — the strip has no horizontal margin of its own and
 *   neither screen pads its root, so the strip's true width IS the window
 *   width, read synchronously. It is a same-frame seed that `onLayout`
 *   immediately supersedes, not a value anything keeps depending on.
 *
 *   `INITIAL_LABEL_WIDTHS` — measured off the Redmi at density 440 (2.75
 *   px/dp): "Listeners" 204px = 74dp, "Astrologers" 259px = 94dp. Another font
 *   scale measures differently and `onLayout` corrects it on the next frame.
 */
const INITIAL_STRIP_WIDTH = Dimensions.get('window').width;
const INITIAL_LABEL_WIDTHS: Record<ProviderCategory, number> = {
  listener: 74,
  astrologer: 94,
};

interface Props {
  /** The SETTLED category — `checked` for TalkBack. Never drives motion. */
  value: ProviderCategory;
  /** Page coordinate, `position + offset`, written on the UI thread by the pager. */
  progress: SharedValue<number>;
  /** A tab was tapped. The screen scrolls the pager; nothing moves here. */
  onSelect: (category: ProviderCategory) => void;
  testID?: string;
}

export function ProviderTypeTabs({
  value,
  progress,
  onSelect,
  testID = 'provider-type-tabs',
}: Props) {
  const styles = useStyles(makeStyles);

  const tabStripWidth = useSharedValue(INITIAL_STRIP_WIDTH);
  const tabLabelWidths = useSharedValue<number[]>(
    PROVIDER_CATEGORIES.map(c => INITIAL_LABEL_WIDTHS[c]),
  );

  const onTabStripLayout = useCallback(
    (width: number) => {
      tabStripWidth.set(width);
    },
    [tabStripWidth],
  );
  // Seeded to match `tabLabelWidths`, so the first real `onLayout` measuring
  // the width the seed already guessed is not written as a change.
  const labelWidths = useRef<number[]>(
    PROVIDER_CATEGORIES.map(c => INITIAL_LABEL_WIDTHS[c]),
  );
  const onTabLabelLayout = useCallback(
    (index: number, width: number) => {
      if (labelWidths.current[index] === width) {
        return;
      }
      labelWidths.current = labelWidths.current.map((w, i) => (i === index ? width : w));
      tabLabelWidths.set(labelWidths.current);
    },
    [tabLabelWidths],
  );

  /*
   * Bluesky's `indicatorStyle`, re-expressed for two fixed halves.
   *
   * The indicator is ONE full-strip-width view (`left: 0, right: 0`) that is
   * moved and scaled, never resized: `translateX` puts its centre on the
   * centre of the tab at `progress`, `scaleX` shrinks it to that tab's
   * indicator width over the strip width. Both are interpolated across the tab
   * indices, so at 0.5 the bar sits halfway and is halfway between the two
   * label widths. Transform only, so no frame of a drag runs layout — and the
   * bar is square, so `scaleX` has no corner radius to smear.
   *
   * Width per tab is Bluesky's `getScaleX`: the label's width, floored at 45,
   * capped at the item (here the whole half; Bluesky subtracts a ScrollView
   * content padding this strip does not have).
   *
   * Clamped, where Bluesky's is not: ViewPager2 never reports a position
   * outside [0, pageCount - 1] on Android (it has no overdrag), so the clamp
   * changes nothing there and only guards a stale value against a future page
   * count change.
   */
  const tabIndicatorStyle = useAnimatedStyle(() => {
    const width = tabStripWidth.get();
    const slot = width / TAB_INDICES.length;
    if (slot <= 0) {
      return { opacity: 0, transform: [{ translateX: 0 }, { scaleX: 1 }] };
    }
    const widths = tabLabelWidths.get();
    const centres = TAB_INDICES.map(i => (i + 0.5) * slot - width / 2);
    const scales = TAB_INDICES.map(
      i => Math.min(Math.max(widths[i] ?? 0, TAB_INDICATOR_MIN_WIDTH), slot) / width,
    );
    const p = progress.get();
    return {
      opacity: 1,
      transform: [
        { translateX: interpolate(p, TAB_INDICES, centres, Extrapolation.CLAMP) },
        { scaleX: interpolate(p, TAB_INDICES, scales, Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <View
      style={styles.tabs}
      testID={testID}
      accessibilityRole="tablist"
      onLayout={e => onTabStripLayout(e.nativeEvent.layout.width)}>
      {PROVIDER_CATEGORIES.map((c, index) => (
        <Pressable
          key={c}
          // The selected category, tapped again, is a re-tap of the screen:
          // back to the top (Bluesky Home.tsx onPressSelected, step 9).
          onPress={() => (c === value ? emitSoftReset() : onSelect(c))}
          testID={`${testID}-${c}`}
          accessibilityRole="tab"
          checked={c === value}
          accessibilityLabel={CATEGORY_LABEL[c]}
          press="none"
          // No ink: the sliding indicator is the response, as on Bluesky's
          // TabBar and our bottom bar. The ripple read as a stray touch blob
          // across the half-width tab (owner, 2026-10-17).
          highlight="none"
          style={styles.tab}>
          <TabLabel
            index={index}
            label={CATEGORY_LABEL[c]}
            progress={progress}
            onLabelLayout={onTabLabelLayout}
          />
        </Pressable>
      ))}
      <Animated.View pointerEvents="none" style={[styles.tabIndicator, tabIndicatorStyle]} />
    </View>
  );
}

/**
 * One label, as two stacked inks crossfaded by `progress`.
 *
 * Bluesky's item is ONE text in full ink whose opacity interpolates
 * [index - 1, index, index + 1] → [0.7, 1, 0.7]. Amit's decision (2026-09-26)
 * is that an inactive label is text.secondary and the active one
 * text.primary, a registered, measured pair. Both cannot be had by stacking
 * Bluesky's opacity on top of the secondary ink: text.secondary at 0.7
 * measures 3.53:1 on the light base and 3.42:1 on the dark one, under the
 * 4.5:1 floor for 16dp text, while text.secondary alone is 7.41:1 / 5.57:1.
 *
 * So it is the COLOUR that tracks the drag, carried on opacity. The secondary
 * layer lays out the label (and is what `onLayout` measures); a text.primary
 * copy sits exactly on top of it; the two opacities are the same Bluesky
 * interpolation, [index - 1, index, index + 1], with the primary copy going
 * 0 → 1 → 0 and the secondary 1 → 0 → 1. At rest each label is exactly one
 * registered ink at full opacity. In between, the composite (primary at a over
 * secondary at 1 - a over the base) never measures below 5.55:1 light / 5.56:1
 * dark across the whole crossfade (sampled every 0.05 of a, WCAG 2.1 relative
 * luminance), so no frame of a drag drops a label under the floor.
 *
 * Opacity rather than `interpolateColor` on a single text's `color`, because
 * opacity is on Reanimated's synchronous UI-prop path and text `color` is not
 * (`partitionUpdates` in ReanimatedModuleProxy.cpp lists `"color"` as "not
 * supported"): an animated `color` would be a shadow-tree commit per frame for
 * each label, where opacity is a property set on the native view.
 *
 * The primary copy is hidden from TalkBack; the Pressable carries the label.
 */
function TabLabel({
  index,
  label,
  progress,
  onLabelLayout,
}: {
  index: number;
  label: string;
  progress: SharedValue<number>;
  onLabelLayout: (index: number, width: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const baseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [index - 1, index, index + 1],
      [1, 0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  const activeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.get(),
      [index - 1, index, index + 1],
      [0, 1, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <View>
      <Animated.Text
        maxFontSizeMultiplier={TAB_LABEL_FONT_SCALE_CAP}
        allowFontScaling
        onLayout={e => onLabelLayout(index, e.nativeEvent.layout.width)}
        style={[styles.tabLabel, baseStyle]}>
        {label}
      </Animated.Text>
      <Animated.Text
        maxFontSizeMultiplier={TAB_LABEL_FONT_SCALE_CAP}
        allowFontScaling
        accessible={false}
        importantForAccessibility="no"
        style={[styles.tabLabel, styles.tabLabelOn, styles.tabLabelLayer, activeStyle]}>
        {label}
      </Animated.Text>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // Bluesky draws a full-width hairline under the strip (`outerBottomBorder`,
    // TabBar.tsx, bg_contrast_100), so the tabs read as the top edge of the
    // content below rather than floating over it.
    tabs: {
      flexDirection: 'row',
      marginBottom: TOKENS.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    tab: {
      flex: 1,
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: TAB_INDICATOR_SLOT + TAB_LABEL_PAD_BOTTOM,
    },
    // Bluesky pager tab label: text_md font_semi_bold on a 20 line. Inks are
    // Amit's (2026-09-26): inactive text.secondary, active text.primary, never
    // the accent — the underline is the one accent in the strip. See
    // `TabLabel` for how the two inks track the drag.
    tabLabel: {
      ...TOKENS.typography.textMdSemiBold,
      color: t.color.text.secondary,
    },
    tabLabelOn: {
      color: t.color.text.primary,
    },
    tabLabelLayer: {
      ...StyleSheet.absoluteFill,
    },
    tabIndicator: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: TAB_INDICATOR_HEIGHT,
      backgroundColor: t.color.bg.accent,
    },
  });
