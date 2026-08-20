import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { useStore } from '../store/useStore';

const DISMISS_AFTER_MS = 4200;

/** Transient, non-blocking failure surface. No modal, no alert, no dead end. */
export function NoticeBar() {
  const notice = useStore(s => s.notice);
  const setNotice = useStore(s => s.setNotice);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  if (notice === null) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInUp.duration(TOKENS.motion.duration.fast)}
      exiting={FadeOut.duration(TOKENS.motion.duration.fast)}
      style={styles.bar}
      testID="notice-bar"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert">
      <Text allowFontScaling style={styles.text}>
        {notice}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.raised,
    borderWidth: 1,
    borderColor: TOKENS.color.state.danger,
  },
  text: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.primary,
  },
});
