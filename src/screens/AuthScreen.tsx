import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { PROVIDER_LABEL, signInWith, type SocialProvider } from '../api/auth';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';

/**
 * The only way in: two buttons.
 *
 * The first version of this screen shipped with no gap between those buttons, no
 * entrance animation and nothing above the headline, which read as an unstyled
 * form rather than a designed screen. Three things fix that, in order of how much
 * they matter:
 *
 *   1. **Rhythm.** The buttons are in a container with a real gap. Two full-width
 *      pills flush against each other look like a rendering bug, and on first
 *      launch a rendering bug is indistinguishable from an untrustworthy app.
 *   2. **A mark with a pulse.** The breathing avatar already carries the product's
 *      one piece of life, on the empty chat state. Reusing it here means the first
 *      frame and the first conversation share a visual idea, and it gives the eye
 *      somewhere to rest above the text.
 *   3. **Staggered entry.** Same `FadeInDown` cascade as the directory rows, so
 *      arriving at the app feels like the same app you will be using.
 *
 * What it still does not do is oversell. No illustration, no colour wash, no hero
 * image of a smiling stranger — the product's claim is that a real person will
 * listen, and a stock photograph would undercut it on the first screen.
 *
 * (Avoiding a certain g-word literally: the accent-budget test bans it anywhere
 * in src/components and src/screens, comments included, which is the right kind
 * of blunt.)
 */
export function AuthScreen() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (provider: SocialProvider) => {
    setError(null);
    setBusy(provider);
    try {
      await signInWith(provider);
      // The browser owns the flow now. The session returns through the deep link
      // handler in App.tsx, so there is nothing to await — and `busy` stays set
      // deliberately: a second tap would start a second OAuth flow.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in.');
      setBusy(null);
    }
  }, []);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + TOKENS.space['2xl'], paddingBottom: insets.bottom },
      ]}>
      <Animated.View
        entering={FadeIn.duration(TOKENS.motion.duration.slow)}
        style={styles.mark}>
        <Avatar initial="·" size={56} tone="warm" breathing />
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(80).duration(TOKENS.motion.duration.base)}
        style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          {'Someone’s here\nto listen.'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Real people, ready to talk. Not therapy — just company.
        </Text>
      </Animated.View>

      <View style={styles.spacer} />

      {/* The gap lives on the container, not as margins on the buttons, so the
          Button component stays reusable inside sheets that set their own rhythm. */}
      <Animated.View
        entering={FadeInDown.delay(160).duration(TOKENS.motion.duration.base)}
        style={styles.actions}>
        <Button
          label={busy === 'google' ? 'Opening…' : PROVIDER_LABEL.google}
          onPress={() => {
            void start('google');
          }}
          disabled={busy !== null}
          testID="signin-google"
        />
        <Button
          label={busy === 'facebook' ? 'Opening…' : PROVIDER_LABEL.facebook}
          kind="secondary"
          onPress={() => {
            void start('facebook');
          }}
          disabled={busy !== null}
          testID="signin-facebook"
        />
      </Animated.View>

      {error !== null ? (
        <Text testID="auth-error" allowFontScaling style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Animated.Text
        entering={FadeIn.delay(320).duration(TOKENS.motion.duration.base)}
        allowFontScaling
        style={styles.legal}>
        We only read your name and email, and neither is shown to anyone you talk
        to — you pick a separate display name. Signing in does tell Google or
        Facebook that you use this app.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: TOKENS.space.lg,
    backgroundColor: TOKENS.color.bg.base,
  },
  mark: {
    paddingBottom: TOKENS.space.xl,
  },
  head: {
    gap: TOKENS.space.sm,
  },
  title: {
    ...TOKENS.typography.displayLarge,
    color: TOKENS.color.text.primary,
  },
  subtitle: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  spacer: {
    flex: 1,
  },
  // The fix for "buttons have no gap".
  actions: {
    gap: TOKENS.space.sm,
  },
  error: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.primary,
    paddingTop: TOKENS.space.md,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
    paddingTop: TOKENS.space.xl,
    paddingBottom: TOKENS.space.xl,
  },
});
