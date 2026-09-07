import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon } from '../components/Icon';

/**
 * The Calls tab.
 *
 * A destination, not a dead icon: the nav's Calls tab used to do nothing on tap
 * because `App` had no case for it, which read as "broken/unclickable" (Amit,
 * 2026-08-27). There is no call-history store yet, so this is an honest empty
 * state that says so, rather than a tab that swallows the tap. When a history
 * model lands it renders here in place of the empty state.
 */
export function CallsScreen() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
      <View style={styles.nav}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling style={styles.title}>
          Calls
        </Text>
      </View>
      <View style={styles.empty}>
        <Icon name="call" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.emptyTitle}>
          No calls yet
        </Text>
        <Text allowFontScaling style={styles.emptyBody}>
          Your voice and video calls will show up here.
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    nav: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    title: {
      // A screen title, not the brand wordmark — dark, like Home's "Explore",
      // not coral (the accent budget reserves coral for states/actions).
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      marginTop: TOKENS.space.xs,
    },
    emptyBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
