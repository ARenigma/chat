/**
 * M3 Snackbar / transient notice surface.
 *
 * Spec: https://m3.material.io/components/snackbar/specs
 *   Short message, optional action, appears above the nav bar, auto-dismisses.
 *   Container: filled (surface-inverse or surface-container), pill/rounded rect.
 *   Text: body-medium on the container fill.
 *   Action: optional text button (accent colour).
 *
 * Store API (useStore `notice` / `noticeTone` / `setNotice`) is unchanged.
 * UpdateBanner is separate — it has a restart action and must not auto-dismiss.
 *
 * Two tones:
 *   danger   → danger text (same as before — coloured text on a neutral surface).
 *   confirm  → primary text (acknowledgement, not an error).
 */
import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';

const DISMISS_AFTER_MS = 4200;

export function NoticeBar() {
  const styles = useStyles(makeStyles);
  const notice = useStore(s => s.notice);
  const tone = useStore(s => s.noticeTone);
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
      // A confirmation is not an alert; polite gets it announced without
      // interrupting. react-native has no `status` role so the absence is correct.
      accessibilityRole={tone === 'confirm' ? undefined : 'alert'}>
      <Text allowFontScaling style={[styles.text, tone === 'confirm' && styles.textConfirm]}>
        {notice}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  // M3 Snackbar anatomy: rounded container, 4 dp horizontal margin, 8 dp bottom
  // margin (above nav), body-medium text.  The fill is surface-container
  // (bg.sunken) — neutral, not error-coloured — so danger vs. confirm is
  // expressed in the text colour rather than the surface.
  bar: {
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  text: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.state.danger,
  },
  textConfirm: {
    color: t.color.text.primary,
  },
});
