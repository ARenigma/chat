import React from 'react';
import { StyleSheet, View } from 'react-native';
import { type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { LoadingIndicator } from './LoadingIndicator';

/**
 * The one full-surface loading state, so every screen mounts the same way.
 *
 * Screens used to mix RN's platform spinner with hand-drawn rings. This
 * centralises the actual MDC Android widget on `bg.base`, so boot, role checks,
 * and screen first paint share one indicator. LoadingIndicator itself switches
 * from the expressive shape loader to circular progress after five seconds.
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
