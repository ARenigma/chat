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
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { DURATION, EASE_OUT } from '../theme/motion';

/**
 * Hoisted at module scope so Reanimated allocates the builder once, not once
 * per render. Inline builders in JSX are a new object per frame — motion.ts's
 * own `barIn`/`barOut` comments state this, and `NoticeBar` had the same bug.
 *
 * In is slower than out: arriving is an announcement; leaving gets out of the
 * way. Matches `barIn`/`barOut`'s documented asymmetry in motion.ts.
 * EASE_OUT on both: a decelerate curve, no ease-in phase on entry or exit.
 */
const noticeIn = FadeInUp.duration(DURATION.fast)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);
const noticeOut = FadeOut.duration(DURATION.fast)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

const DISMISS_AFTER_MS = 4200;

function NoticeBar() {
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
      entering={noticeIn}
      exiting={noticeOut}
      style={styles.bar}
      // No action on a notice, so it never takes a touch: it can sit over a
      // header control and the tap still reaches the control.
      pointerEvents="none"
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

/**
 * The one place a notice is shown, mounted once at the app root (App.tsx Shell).
 *
 * It used to be placed per screen, which is how the v2 chat, the call screen
 * and the safety sheet lost every notice when the v1 ChatScreen that mounted it
 * was deleted. Pinned under the status bar rather than above the nav bar: the
 * chat window runs `adjustNothing`, so the IME draws over the bottom of every
 * screen and a bottom snackbar would sit behind the keyboard.
 *
 * Deliberate departure from M3's bottom placement
 * (https://m3.material.io/components/snackbar/guidelines, "above the bottom
 * app bar"): with an app-drawn IME inset the bottom is not reliably visible.
 * The top offset is the status-bar inset, because the app is edge-to-edge and
 * must pad its own content clear of the system bars
 * (https://developer.android.com/develop/ui/views/layout/edge-to-edge).
 * `pointerEvents="box-none"` keeps the empty overlay from eating touches on
 * the header beneath it. Asserted in __tests__/platform.test.ts.
 */
export function NoticeOverlay() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[overlay.root, { top: insets.top + TOKENS.space.xs }]}>
      <NoticeBar />
    </View>
  );
}

const overlay = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, zIndex: 1000, elevation: 1000 },
});

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
