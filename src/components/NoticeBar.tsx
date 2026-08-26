import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';

const DISMISS_AFTER_MS = 4200;

/**
 * Transient, non-blocking notice surface. No modal, no alert, no dead end.
 *
 * Two appearances, one channel. It had one, a danger border, and the same bar
 * carried "Blocked. They can no longer message you.", "Reported.", "Application
 * submitted." and "Thanks, that helps the next person choose.". A thank-you in
 * a red box is not a small cosmetic issue: it tells the user something went
 * wrong immediately after they did something right.
 *
 * A confirmation gets the hairline border rather than a green one, deliberately.
 * Success does not need a colour to be legible, and the accent budget is spent
 * on the things that ask for attention.
 */
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
      // A confirmation is not an alert. `polite` already gets it announced;
      // `role="alert"` on top of that is an interruption a thank-you has not
      // earned. (React Native has no `status` role, the absence is the
      // correct expression of "announce, do not interrupt".)
      accessibilityRole={tone === 'confirm' ? undefined : 'alert'}>
      <Text allowFontScaling style={[styles.text, tone === 'confirm' && styles.textConfirm]}>
        {notice}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  bar: {
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    // A fill, not a ring. `bg/raised` was #FFFFFF on a white page, so the 1px
    // `state/danger` border was the whole component, which is a Material
    // snackbar's error variant. iOS has no snackbar at all, and its nearest idiom
    // for an error is coloured text next to the control that failed, so the
    // colour moves onto the text and the box becomes a neutral fill.
    backgroundColor: t.color.bg.sunken,
  },
  text: {
    ...TOKENS.typography.captionRegular,
    color: t.color.state.danger,
  },
  textConfirm: {
    color: t.color.text.primary,
  },
});
