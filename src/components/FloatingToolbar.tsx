import React, { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { DURATION, fadeTo, springTo } from '../theme/motion';
import { tick } from '../lib/haptics';
import { CALLS_TAB_ENABLED } from '../config';
import { Frost } from './Frost';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { TourAnchor } from './TourAnchor';
import { Badge } from './Badge';
import type { TourTargetId } from '../store/useHomeTour';

export type ToolbarKey = 'home' | 'favourites' | 'call' | 'settings';

/**
 * The bar's own height, without the safe-area inset. Exported so the two tab
 * screens (Home, Settings) can pad their scroll content by exactly this much and
 * their last row clears the frosted overlay instead of resting behind it — and,
 * critically, so no full-width row sits *under* the bar to steal its taps.
 */
export const NAV_BAR_HEIGHT = 60;

interface Tab {
  key: ToolbarKey;
  glyph: IconName;
  label: string;
  hint: string;
}

const TABS: readonly Tab[] = [
  { key: 'home', glyph: 'home', label: 'Home', hint: 'People and conversations' },
  { key: 'favourites', glyph: 'heart', label: 'Favourites', hint: 'People you saved' },
  { key: 'call', glyph: 'call', label: 'Calls', hint: 'Your recent calls' },
  // WhatsApp's current profile-first destination names the person, not the
  // utility. The route key stays `settings`; only the visible navigation label
  // becomes "You". https://wabetainfo.com/whatsapp-beta-for-android-2-26-6-4-whats-new/
  { key: 'settings', glyph: 'person', label: 'You', hint: 'Your account and settings' },
];

interface Props {
  active: ToolbarKey;
  onSelect: (key: ToolbarKey) => void;
  /**
   * Calls are built but gated (`CALLS_ENABLED`). A disabled tab is dimmed and
   * still announces its state rather than vanishing, so the bar's shape does not
   * change when the flag flips.
   */
  callEnabled?: boolean;
  /**
   * Unread count shown as a Badge on the Home tab pill.  0 hides the badge.
   * Pass the total unread count from the rail so the user knows there is
   * activity without navigating to the chats list.
   */
  homeBadgeCount?: number;
  /**
   * False on a pushed screen. The bar is HIDDEN, never unmounted — see the note
   * on the returned element.
   */
  visible?: boolean;
}

/**
 * The tonal indicator pill behind the active tab's glyph.
 *
 * M3 NavigationBar animates the active indicator rather than hard-toggling a
 * background: it grows along its width and fades in as a destination is
 * selected. `scaleX` on the fast spatial spring (a small, quick component) with
 * the fill fading on effects timing; both settle where the discrete style used
 * to snap. Separated into its own component so each slot owns one shared value
 * and the animation is keyed on that slot's own `active`.
 */
function Indicator({ active }: { active: boolean }) {
  const styles = useStyles(makeStyles);
  const opacity = useSharedValue(active ? 1 : 0);
  const scaleX = useSharedValue(active ? 1 : 0.6);
  useEffect(() => {
    opacity.value = fadeTo(active ? 1 : 0, DURATION.fast);
    scaleX.value = springTo(active ? 1 : 0.6, 'spatialFast');
  }, [active, opacity, scaleX]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scaleX: scaleX.value }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.indicatorFill, style]} />;
}

/**
 * The docked bottom bar: one strip, three destinations.
 *
 * Press feedback follows Material 3 NavigationBar: the whole slot is tappable
 * (48dp), but the state layer is clipped to the indicator pill, not a full-width
 * rectangle. See m3.material.io/foundations/interaction/states/state-layers and
 * NavigationBarItem's indicator-shaped ripple.
 */
function FloatingToolbarView({
  active,
  onSelect,
  callEnabled = false,
  homeBadgeCount = 0,
  visible = true,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // When CALLS_TAB_ENABLED is false the 'call' tab is absent entirely and the
  // remaining three tabs fill the bar via `space-around`. The ToolbarKey union
  // and the routes.ts 'calls' route type are unchanged so the tab can be
  // re-enabled by flipping the flag.
  const visibleTabs = CALLS_TAB_ENABLED ? TABS : TABS.filter(t => t.key !== 'call');

  return (
    /*
     * Kept MOUNTED on pushed screens and hidden with `display: none`, not
     * unmounted — the same treatment, for the same reason, as the emoji panel
     * (EmojiPicker.tsx:258, citing Telegram's create-once/setVisibility
     * lifecycle at ChatActivityEnterView.java:12622 and :12746).
     *
     * Rendering it conditionally meant every push and every pop destroyed and
     * rebuilt a `Frost` — one of our native RenderEffect blur surfaces — plus
     * four Pressables and four Indicators with their shared values, on the JS
     * thread, inside the frame that was already animating a screen transition.
     *
     * This costs nothing in layout because the bar is `position: 'absolute'`:
     * it never took height from the content area, and pushed screens were
     * already full height. `display: none` also takes it out of layout and out
     * of drawing, so a hidden bar is not blurring a chat transcript behind it.
     */
    <Frost
      edge="top"
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.bar,
        { paddingBottom: insets.bottom + TOKENS.space['2xs'] },
        visible ? null : styles.hidden,
      ]}>
        {visibleTabs.map(tab => {
          const on = tab.key === active;
          const disabled = tab.key === 'call' && !callEnabled;
          const tourId: TourTargetId | null =
            tab.key === 'home' ? 'home' : tab.key === 'favourites' ? 'favourites' : null;
          const tabButton = (
            <Pressable
              onPress={() => {
                tick();
                onSelect(tab.key);
              }}
              disabled={disabled}
              testID={`nav-${tab.key}`}
              accessibilityLabel={tab.label}
              accessibilityHint={disabled ? 'Coming soon' : tab.hint}
              accessibilityRole="tab"
              selected={on}
              press="none"
              size={48}
              style={styles.indicator}>
              <Indicator active={on} />
              <Icon
                name={tab.glyph}
                // Keep the Lucide heart outlined in both states. The tonal pill
                // and accent colour already identify the selected destination;
                // a filled heart reads as a save action instead of navigation.
                active={on && tab.key !== 'favourites'}
                // 20 * the 1.2 icon scale = ~24px, the Material 3 nav icon size.
                size={20}
                color={
                  on
                    ? theme.color.text.accent
                    : disabled
                      ? theme.color.text.tertiary
                      : theme.color.text.secondary
                }
              />
              {tab.key === 'home' && homeBadgeCount > 0 ? (
                <Badge count={homeBadgeCount} />
              ) : null}
            </Pressable>
          );
          return (
            <View key={tab.key} style={styles.slot}>
              {tourId !== null ? <TourAnchor id={tourId}>{tabButton}</TourAnchor> : tabButton}
            </View>
          );
        })}
    </Frost>
  );
}

export const FloatingToolbar = memo(FloatingToolbarView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingTop: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.sm,
    },
    // Out of layout and out of drawing, rather than transparent: an
    // `opacity: 0` bar would still lay out and still run its RenderEffect blur
    // over whatever screen is on top of it, every frame, forever.
    hidden: { display: 'none' },
    slot: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Pill-shaped press target: M3 clips the nav state layer to the indicator,
    // not the full slot. overflow:hidden on Pressable clips the 10% layer here.
    indicator: {
      width: 64,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // M3 NavigationBar indicator: tonal fill, not a lone coral glyph, animated in
    // behind the glyph (see the Indicator component). Absolutely filling the
    // pill so scaleX grows it from its centre without moving the icon.
    // https://m3.material.io/components/navigation-bar/guidelines
    indicatorFill: {
      ...StyleSheet.absoluteFill,
      borderRadius: 16,
      backgroundColor: t.color.bg.accentTint,
    },
  });
