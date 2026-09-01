import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Button } from '../components/Button';
import { LoadingIndicator } from '../components/LoadingIndicator';

interface Props {
  /** Shown when the wait stops being plausible. */
  onRetry?: () => void;
}

/** After this long, "loading" is indistinguishable from "broken". */
const PATIENCE_MS = 6000;

/**
 * What used to be `<View style={styles.blank} />`.
 *
 * That was the bug behind "blank white screen after signing in": every
 * indeterminate state, session check, profile fetch, OAuth hand-back, rendered
 * an empty view with no spinner, no timeout and no way out. If any of those
 * hung, the app was a white rectangle forever and there was nothing on screen to
 * even tell you it was waiting.
 *
 * A spinner is the minimum. The timeout matters more: it converts an invisible
 * hang into a stated failure with a retry, which is the difference between a bug
 * report that says "blank screen" and one that says what actually broke.
 */
export function SplashScreen({ onRetry }: Props) {
  const styles = useStyles(makeStyles);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.root}>
      {/* LoadingIndicator owns the M3 five-second boundary globally: expressive
          shape first, native circular indeterminate progress for a long wait.
          https://m3.material.io/components/loading-indicator/overview */}
      <LoadingIndicator size={48} />
      {slow ? (
        <View style={styles.slow}>
          <Text testID="splash-slow" allowFontScaling style={styles.text}>
            This is taking longer than it should.
          </Text>
          {onRetry !== undefined ? (
            <View style={styles.action}>
              <Button label="Try Again" onPress={onRetry} testID="splash-retry" />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: TOKENS.space.xl,
    paddingHorizontal: TOKENS.space['2xl'],
    backgroundColor: t.color.bg.base,
  },
  slow: {
    alignItems: 'center',
    gap: TOKENS.space.lg,
    alignSelf: 'stretch',
  },
  text: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
  },
});
