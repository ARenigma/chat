import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { LoadingIndicator } from './LoadingIndicator';

/**
 * The one full-surface loading state, so every screen mounts the same way.
 *
 * Screens used to reach for RN's `ActivityIndicator` (Android's Material sweep)
 * for their loading branch while the rest of the app — buttons, auth, onboarding
 * — used the hand-drawn `Spinner` ring. Two different glyphs meant a cold start
 * cut between a platform sweep on the splash and a ring elsewhere. This centralises
 * the ring on `bg.base` so the boot splash, the role check, and each screen's
 * first paint are visually identical.
 */
export function ScreenLoader({ testID }: { testID?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root} testID={testID}>
      <LoadingIndicator size={48} />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.base,
    },
  });
