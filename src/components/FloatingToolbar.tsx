import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Frost } from './Frost';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';

export type ToolbarKey = 'home' | 'call' | 'settings';

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
  { key: 'call', glyph: 'call', label: 'Calls', hint: 'Your recent calls' },
  { key: 'settings', glyph: 'settings', label: 'Settings', hint: 'Account and privacy' },
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
}

/**
 * The docked bottom bar: one strip, three destinations.
 *
 * This is the Sweprek/Mengobrol idiom (Amit's call, 2026-08-26), and it is a
 * deliberate reversal of the floating coral capsule that stood here through v13.
 * Two things changed with it:
 *
 *   - **Docked, not floating.** A full-width bar pinned to the bottom edge on a
 *     translucent `bg/chrome` fill, so the list scrolling under it shows through
 *     as a frost. `bg/chrome` is the page colour at 80% — an approximation of a
 *     real Gaussian blur, which needs a native BlurView dependency this app has
 *     not taken. A top hairline and a soft upward shadow carry the edge the
 *     translucency alone cannot. If the frost does not read on device this is the
 *     one place a BlurView would slot in, behind the same bar.
 *   - **Black active, not coral.** The selected tab is a black pill (`bg/inverse`)
 *     carrying a filled white glyph and its label; the others are bare grey
 *     glyphs. Black is reserved for nav highlight only — the coral stays the
 *     brand accent everywhere else — so the one place the eye is told "you are
 *     here" cannot be confused with the one place it is told "act". The pill is
 *     both a shape signal and a colour one (Material's own selection pattern,
 *     ADR-0018), which survives colour-blindness and now also carries the label
 *     the floating capsule had no room for.
 */
function FloatingToolbarView({ active, onSelect, callEnabled = false }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    // A frosted overlay pinned to the bottom edge (Amit's call, 2026-08-27): the
    // Home/Settings list scrolls *under* it so the real blur has live content to
    // frost. The device bug that once forced a docked bar was a full-width list
    // row underlapping the bar and stealing its taps — fixed here not by docking
    // but by the two tab screens padding their content by `NAV_BAR_HEIGHT`, so no
    // row ever sits beneath the bar. The bar renders last in the tree, so its own
    // taps are never in question.
    <Frost
      edge="top"
      style={[styles.bar, { paddingBottom: insets.bottom + TOKENS.space['2xs'] }]}>
        {TABS.map(tab => {
          const on = tab.key === active;
          const disabled = tab.key === 'call' && !callEnabled;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onSelect(tab.key)}
              disabled={disabled}
              testID={`nav-${tab.key}`}
              accessibilityLabel={tab.label}
              accessibilityHint={disabled ? 'Coming soon' : tab.hint}
              // A nav item is a tab, and its chosen state belongs in
              // accessibilityState, not spelled into the label.
              accessibilityRole="tab"
              selected={on}
              press="none"
              style={styles.slot}>
              {/* Icon-only (Amit's call): a FIXED-size active indicator pill sits
                  behind the glyph on the selected tab — no label, so the tab's
                  width never changes and the bar cannot reflow or shove the icons
                  when you switch. Layout lives on this wrapper, never on the
                  Pressable, whose layout style reaches an inner view. */}
              <View style={styles.indicator}>
                <Icon
                  name={tab.glyph}
                  active={on}
                  // 20 * the 1.2 icon scale = ~24px, the Material 3 nav icon size.
                  // Was 24 (~29px), which read oversized against 14–16sp body text.
                  size={20}
                  color={
                    on
                      ? theme.color.bg.accent
                      : disabled
                        ? theme.color.text.tertiary
                        : theme.color.text.secondary
                  }
                />
              </View>
            </Pressable>
          );
        })}
    </Frost>
  );
}

export const FloatingToolbar = memo(FloatingToolbarView);

// No theme colours here any more: the bar is transparent (Frost fills it) and the
// active tab is signalled by the glyph's own colour, set in the component.
const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    // Pinned to the bottom edge as an overlay, so the list frosts as it passes
    // under it. Transparent: `Frost` draws the blur, the chrome tint and the top
    // hairline. zIndex (not elevation) keeps it above the list without an Android
    // drop shadow, which under a translucent bar reads as a smudge.
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
    // Equal-width slots so the three tabs are evenly spaced and none can grow.
    slot: {
      flex: 1,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // No pill, no disc — the selected tab is signalled by the glyph alone: a coral
    // FILLED glyph when active, a grey outline glyph otherwise (Amit, 2026-08-27,
    // after black-slab and grey-box and accent-pill all read as "a shape around
    // the icon"). This wrapper only reserves a fixed box so switching tabs never
    // reflows the row; it draws nothing itself.
    indicator: {
      width: 64,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
