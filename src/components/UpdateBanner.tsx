import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInUp, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { DURATION, EASE_OUT } from '../theme/motion';

/**
 * Hoisted at module scope so Reanimated allocates the builder once, not once
 * per render. See NoticeBar.tsx for the same fix and reasoning.
 *
 * In is slower than out (base vs fast), matching `barIn`/`barOut`'s documented
 * asymmetry: arriving is an announcement; leaving gets out of the way.
 * EASE_OUT on both: decelerate curve, no ease-in phase on entry or exit.
 */
const bannerIn = FadeInUp.duration(DURATION.base)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);
const bannerOut = FadeOut.duration(DURATION.fast)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);
import { Pressable } from './Pressable';
import { completeUpdate, watchForUpdates } from '../lib/appUpdate';
import { updateNotice, type UpdateAction } from '../lib/updatePolicy';

/**
 * "An update is ready. Restart to finish."
 *
 * A separate surface from NoticeBar, and the reason is behavioural rather than
 * stylistic: NoticeBar dismisses itself after 4.2 seconds and cannot be tapped.
 * That is right for "Reported." and wrong for this, which is the one notice in
 * the app that asks the user to *do* something and must wait until they do.
 * Google's own sample uses an indefinite snackbar with a RESTART action for
 * exactly this reason.
 *
 * It only ever appears for a flexible update that has finished downloading.
 * Play draws its own UI for the download itself and for immediate updates, so
 * anything here would be a second voice saying the same thing.
 *
 * **Deliberately Android-shaped, and left alone by the iOS pass.** A snackbar has
 * no iOS equivalent because the App Store owns updates there, and
 * `src/lib/appUpdate.ts` already gates on `Platform.OS === 'android'`, so on iOS
 * this renders nothing at all. There is no iPhone idiom to move it towards, and a
 * future pass should not invent one.
 */
export function UpdateBanner() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [action, setAction] = useState<UpdateAction>({ kind: 'none' });

  useEffect(() => watchForUpdates(setAction), []);

  const message = updateNotice(action);
  if (action.kind !== 'promptRestart' || message === null) {
    return null;
  }

  return (
    <Animated.View
      entering={bannerIn}
      exiting={bannerOut}
      style={[styles.host, { bottom: insets.bottom + TOKENS.space.md }]}>
      <Text allowFontScaling style={styles.text}>
        {message}
      </Text>
      {/* Restarting is destructive to whatever is on screen, so it is never
          automatic, the app closes and reopens, and a half-typed message would
          go with it. */}
      <Pressable
        onPress={() => {
          void completeUpdate();
        }}
        accessibilityLabel="Restart to finish updating"
        accessibilityHint="Closes and reopens the app"
        press="none"
        highlight="dim"
        testID="update-restart"
        style={styles.action}>
        <Text allowFontScaling style={styles.actionLabel}>
          Restart
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    position: 'absolute',
    left: TOKENS.space.md,
    right: TOKENS.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingVertical: TOKENS.space.sm,
    paddingLeft: TOKENS.space.md,
    paddingRight: TOKENS.space.xs,
    borderRadius: TOKENS.radius.lg,
    // Inverse, like a snackbar: this sits over whatever screen you are on and
    // has to read as a layer above it rather than another card on it.
    backgroundColor: t.color.bg.inverse,
  },
  text: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.onInverse,
    flex: 1,
  },
  action: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
    borderRadius: TOKENS.radius.md,
  },
  actionLabel: {
    ...TOKENS.typography.labelLargeEmphasized,
    color: t.color.text.onInverse,
  },
});
