import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';

export type ToolbarKey = 'home' | 'call' | 'settings';

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
   * still announces its state rather than vanishing, so the toolbar's shape does
   * not change when the flag flips.
   */
  callEnabled?: boolean;
}

/**
 * The v13 floating toolbar: one pill, three destinations.
 *
 * This replaces the first-gen two-tab bar (`TabBar`, chats/explore). v13 merges
 * Chats and Explore into a single Home, so the navigation is Home / Calls /
 * Settings — a floating capsule over the content rather than a docked bar, which
 * is why it carries an elevation the docked bar deliberately refused: a docked bar
 * on white reads a shadow as a smudge, but a floating pill needs the shadow to
 * read as lifted off the list scrolling under it.
 *
 * The active tab is a filled coral disc under a filled-family glyph (Material's
 * own selection pattern, ADR-0018) — a shape signal, not only a colour one, which
 * also survives colour-blindness.
 */
function FloatingToolbarView({ active, onSelect, callEnabled = false }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + TOKENS.space.sm }]} pointerEvents="box-none">
      <View style={styles.pill}>
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
              <View style={[styles.disc, on && styles.discOn]}>
                <Icon
                  name={tab.glyph}
                  active={on}
                  size={24}
                  color={
                    on
                      ? theme.color.text.onAccent
                      : disabled
                        ? theme.color.text.tertiary
                        : theme.color.text.secondary
                  }
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const FloatingToolbar = memo(FloatingToolbarView);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // Centred over the content. `box-none` so taps outside the pill fall through
    // to the list scrolling beneath it.
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    // 232 x 64 from the frame. A capsule, raised off the list.
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xl,
      height: 64,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: 32,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.raised,
      // Soft lift. Elevation for Android, shadow for the iOS surface language.
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.14,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    slot: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disc: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discOn: {
      backgroundColor: t.color.bg.accent,
    },
  });
