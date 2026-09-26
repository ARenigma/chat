/**
 * The bottom tab bar, Bluesky's bar with the M3 indicator pill kept.
 *
 * Owner decisions (2026-09-25/27): opaque surface with a hairline top border,
 * no ripple, no Frost, icon-only for both roles (the a11y labels stay), the M3
 * pill behind the selected icon, the filled Phosphor glyph when selected, and
 * the `press="tab"` 0.90 press on every slot.
 *
 * Buttons are built from `props.state.routes`, so a tab the navigator did not
 * register (CallsTab while CALLS_TAB_ENABLED is off) has no button, and the
 * remaining slots share the width.
 *
 * Wired in step 7 as a STABLE `tabBar` callback:
 *   useCallback((p: BottomTabBarProps) => <BottomBar {...p} tabs={MEMBER_TABS} />, [])
 *
 * adapted from bluesky-social/social-app src/view/shell/bottom-bar/BottomBar.tsx
 * (MIT), see THIRD_PARTY_LICENSES.md
 */

import React, { memo, useCallback, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { StackActions } from '@react-navigation/native';
import { TOKENS } from '../../theme/tokens';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import { INTERACTION, springTo } from '../../theme/motion';
import { Badge } from '../../components/Badge';
import { Icon, type IconName } from '../../components/Icon';
import { Pressable } from '../../components/Pressable';
import { TourAnchor } from '../../components/TourAnchor';
import { useDedupe } from '../../hooks/useDedupe';
import { emitSoftReset } from '../../lib/events';
import { getTabState, TabState } from '../../lib/routes/helpers';
import type { TourTargetId } from '../../store/useHomeTour';
import { useShellLayout } from '../shellLayout';
import { useMinimalShellHidden } from '../minimalMode';
import { useMinimalShellFooterTransform } from '../useMinimalShellTransform';
import { useMemberUnreadTotal, useNoBadge, useProviderWaitingCount } from '../badgeCounts';
import { clampBottomInset, INDICATOR_WIDTH, makeStyles } from './BottomBarStyles';

/** A tab root name, the `X` of the `XTab` navigator route (Bluesky `isTab`). */
export type TabRootName = 'Home' | 'Favourites' | 'Calls' | 'You' | 'Chats' | 'Saved';

export interface BottomBarTab {
  name: TabRootName;
  glyph: IconName;
  /** The TalkBack name. The bar is icon-only, so this is the only label. */
  label: string;
  hint: string;
  testID: string;
  /** Home and Favourites are spotlight-tour targets; the anchor is kept. */
  tourId?: TourTargetId;
  /** The badge count source. Called as a hook in the slot, so it must be one. */
  useBadgeCount?: () => number;
}

// The route key and testIDs are the FloatingToolbar's, so maestro flows and the
// CriticalJourneyBenchmark `requireDescription` lookups keep working.
export const MEMBER_TABS: readonly BottomBarTab[] = [
  {
    name: 'Home',
    glyph: 'home',
    label: 'Home',
    hint: 'People and conversations',
    testID: 'nav-home',
    tourId: 'home',
    useBadgeCount: useMemberUnreadTotal,
  },
  {
    name: 'Favourites',
    glyph: 'heart',
    label: 'Favourites',
    hint: 'People you saved',
    testID: 'nav-favourites',
    tourId: 'favourites',
  },
  { name: 'Calls', glyph: 'call', label: 'Calls', hint: 'Your recent calls', testID: 'nav-call' },
  {
    name: 'You',
    glyph: 'person',
    label: 'You',
    hint: 'Your account and settings',
    testID: 'nav-settings',
  },
];

export const PROVIDER_TABS: readonly BottomBarTab[] = [
  {
    name: 'Chats',
    glyph: 'chat',
    label: 'Chats',
    hint: 'People waiting for you',
    testID: 'nav-chats',
    useBadgeCount: useProviderWaitingCount,
  },
  { name: 'Saved', glyph: 'heart', label: 'Saved', hint: 'People you saved', testID: 'nav-saved' },
  {
    name: 'You',
    glyph: 'person',
    label: 'You',
    hint: 'Your account and settings',
    testID: 'nav-settings',
  },
];

type Props = BottomTabBarProps & { tabs: readonly BottomBarTab[] };

function BottomBarView({ state, navigation, tabs }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { footerHeight } = useShellLayout();
  const hidden = useMinimalShellHidden();
  const footerTransform = useMinimalShellFooterTransform();
  const dedupe = useDedupe(250);

  // The bar is gone: nothing may still offset content by its old height.
  useEffect(() => () => footerHeight.set(0), [footerHeight]);

  /*
   * Bluesky BottomBar.tsx onPressTab, read against the FRESH state:
   * - at the tab's root already: soft reset (scroll to top; listeners are
   *   step 9). Not deduped, a second re-tap is a second request.
   * - inside the tab with something pushed: pop THAT tab's stack to its root,
   *   targeted by the stack's key, falling back to a reset of the tab.
   * - another tab: navigate to it.
   * No `tabPress` emit and no useScrollToTop: the soft reset is the one re-tap
   * path. No haptic: a tab select is navigation, not a committed action.
   */
  const onPressTab = useCallback(
    (tab: TabRootName) => {
      const current = navigation.getState();
      const tabState = getTabState(current, tab);
      if (tabState === TabState.InsideAtRoot) {
        emitSoftReset();
      } else if (tabState === TabState.Inside) {
        const target = current.routes.find(r => r.name === `${tab}Tab`)?.state?.key;
        dedupe(() => {
          if (target !== undefined) {
            navigation.dispatch({ ...StackActions.popToTop(), target });
          } else {
            navigation.reset({ index: 0, routes: [{ name: `${tab}Tab` }] });
          }
        });
      } else {
        dedupe(() => navigation.navigate(`${tab}Tab`));
      }
    },
    [navigation, dedupe],
  );

  return (
    <Animated.View
      accessibilityRole="tablist"
      // While a minimal screen is up the bar is transparent AND out of the
      // accessibility tree and out of touch, so no nav-* node is reachable over
      // a chat or a call (nav-migration B32). `no-hide-descendants` hides the
      // view and every descendant from accessibility services
      // (https://reactnative.dev/docs/accessibility#importantforaccessibility-android,
      // developer.android.com/reference/android/view/View#setImportantForAccessibility(int)).
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      pointerEvents={hidden ? 'none' : 'auto'}
      onLayout={e => footerHeight.set(e.nativeEvent.layout.height)}
      style={[
        styles.root,
        // Edge-to-edge: the app draws behind the navigation bar and pads its own
        // chrome by the inset (developer.android.com/develop/ui/views/layout/edge-to-edge),
        // clamped as Bluesky does.
        { paddingBottom: clampBottomInset(insets.bottom) },
        footerTransform,
      ]}>
      <View style={styles.slots}>
        {state.routes.map(route => {
          const tab = tabs.find(t => `${t.name}Tab` === route.name);
          if (tab === undefined) {
            return null;
          }
          const selected = getTabState(state, tab.name) !== TabState.Outside;
          return <Slot key={route.key} tab={tab} selected={selected} onPressTab={onPressTab} />;
        })}
      </View>
    </Animated.View>
  );
}

export const BottomBar = memo(BottomBarView);

interface SlotProps {
  tab: BottomBarTab;
  selected: boolean;
  onPressTab: (tab: TabRootName) => void;
}

function SlotView({ tab, selected, onPressTab }: SlotProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // A tab's spec is a module constant, so each slot calls the same hook on
  // every render; hook order is stable.
  const useCount = tab.useBadgeCount ?? useNoBadge;
  const count = useCount();
  const { name } = tab;
  const onPress = useCallback(() => onPressTab(name), [onPressTab, name]);

  const button = (
    <Pressable
      onPress={onPress}
      testID={tab.testID}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityHint={count > 0 ? `${tab.hint}, ${count} unread` : tab.hint}
      selected={selected}
      // Bluesky's press (PressableScale), at the owner's 0.90: the whole slot,
      // pill and glyph together. Transform dropped under reduced motion.
      press="tab"
      // No ripple and no state layer: the Bluesky bar answers a touch with the
      // scale alone (owner, 2026-09-25).
      highlight="none"
      size={INTERACTION.minTarget}
      style={styles.slot}>
      <Indicator selected={selected} />
      <View style={styles.iconBox}>
        <Icon
          name={tab.glyph}
          // The filled Phosphor glyph when selected: M3 "the icon of the active
          // destination is filled" (m3.material.io/components/navigation-bar/guidelines).
          active={selected}
          size={TOKENS.icon.md}
          // text/navSelected on bg/navIndicator: 4.46:1 light (step 500 on
          // 50), 4.33:1 dark (step 400 on 900), over the 3:1 non-text floor
          // (scripts/check-contrast.mjs). Dark is 400, not the brand 500,
          // because 500 on the 900 pill is 2.87:1 (owner, 2026-09-27).
          color={selected ? theme.color.text.navSelected : theme.color.text.secondary}
        />
        <Badge count={count} placement="badgedBox" />
      </View>
    </Pressable>
  );

  return tab.tourId !== undefined ? (
    <TourAnchor id={tab.tourId} style={styles.anchor}>
      {button}
    </TourAnchor>
  ) : (
    button
  );
}

const Slot = memo(SlotView);

/**
 * The M3 active indicator: the pill grows along its width and fades in as its
 * destination is selected (m3.material.io/components/navigation-bar/guidelines).
 *
 * WIDTH, not `scaleX`: the pill is absolute and childless, so a width change
 * re-lays-out nothing else, and it keeps the full corner that `scaleX` would
 * smear into an oval (animate-expo step 4). Width on the M3 spatialFast spring,
 * opacity on effectsDefault, the M3 spatial/effects split. It rides a tab
 * switch (100+/day), and it is the platform component's own default motion,
 * not an addition.
 *
 * Reduced motion: the width is fixed at 64 and only the fade runs
 * (`ReduceMotion.Never` on the opacity, since it is the state change itself).
 */
function IndicatorView({ selected }: { selected: boolean }) {
  const styles = useStyles(makeStyles);
  const reduced = useReducedMotion();
  const width = useSharedValue(selected || reduced ? INDICATOR_WIDTH : 0);
  const opacity = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      width.set(springTo(selected ? INDICATOR_WIDTH : 0, 'spatialFast'));
    }
    opacity.set(springTo(selected ? 1 : 0, 'effectsDefault', undefined, ReduceMotion.Never));
  }, [selected, reduced, width, opacity]);

  const style = useAnimatedStyle(() => ({
    // spatialFast is ratio 0.9; the clamp keeps an undershoot past 0 from
    // becoming a negative width.
    width: Math.max(0, width.get()),
    opacity: opacity.get(),
  }));

  return <Animated.View pointerEvents="none" style={[styles.indicator, style]} />;
}

const Indicator = memo(IndicatorView);
