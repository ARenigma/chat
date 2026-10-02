/**
 * Appearance settings — pushed from the You tab's "Appearance" row.
 *
 * Ports Bluesky's AppearanceSettings screen to our token/component layer.
 * SegmentedControl → Pressable radio rows (no SegmentedControl in this
 * codebase). Font and dark-theme sub-controls are Bluesky-specific and
 * omitted here; colour mode (System / Light / Dark) is the full surface.
 *
 * adapted from bluesky-social/social-app
 * src/screens/Settings/AppearanceSettings.tsx (MIT)
 * see THIRD_PARTY_LICENSES.md
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOKENS, type Theme } from '../theme/tokens';
import { type ThemeMode, useStyles, useTheme, useThemeMode } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { BackButton } from '../components/BackButton';
import { Icon } from '../components/Icon';
import { SegmentedControl } from '../components/SegmentedControl';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

interface Props {
  onBack: () => void;
}

const COLOR_MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Colour mode picker: System / Light / Dark.
 *
 * Bluesky routes to this via "/settings/appearance" from a LinkItem in the
 * main Settings list. We mirror that: the "Appearance" row in SettingsSheet
 * pushes this screen onto the You tab's native stack, so the transition is
 * the platform's default slide and back pops it in the same motion.
 *
 * Emil frequency gate: settings rows are a tens-a-day surface, so radio rows
 * get state-layer feedback only, no enter/exit motion beyond the stack push.
 */
export function AppearanceScreen({ onBack }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="appearance-back" style={styles.barIcon} />
        <Text
          allowFontScaling
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          style={styles.barTitle}
        >
          Appearance
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={[styles.scroll, { paddingBottom: barOffset }]}
      >
        {/* Bluesky's AppearanceToggleButtonGroup: the group's icon and title
            on one line, the segmented control under it (social-app
            AppearanceSettings.tsx). Font and Dim/Dark do not apply to us. */}
        <View style={styles.groupHead}>
          <Icon name="device" size={TOKENS.icon.md} color={theme.color.text.primary} />
          <Text allowFontScaling style={styles.groupTitle}>
            Color mode
          </Text>
        </View>
        <SegmentedControl
          label="Color mode"
          value={mode}
          onChange={setMode}
          options={COLOR_MODES}
          testID="appearance-mode"
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // SettingsList.Group with ItemIcon + ItemText: 8dp gap (a.gap_sm).
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      minHeight: TOKENS.interaction.minTarget,
      marginBottom: TOKENS.space.xs,
    },
    groupTitle: {
      ...TOKENS.typography.textMd,
      color: t.color.text.primary,
      flex: 1,
    },
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    // Bluesky's Layout.Header.Outer on native: a row, 8dp gap, 16dp gutters,
    // minHeight 48 with pb_xs, and a low-contrast rule under it. The title is
    // left-aligned on Android (it centres only on iOS).
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space['2xs'],
      minHeight: TOKENS.interaction.minTarget,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    barIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barTitle: {
      flex: 1,
      ...TOKENS.typography.textLgSemiBoldTight,
      color: t.color.text.primary,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.xl,
      paddingTop: TOKENS.space.md,
    },
  });
