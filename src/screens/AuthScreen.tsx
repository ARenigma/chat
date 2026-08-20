import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { PROVIDER_LABEL, signInWith, type SocialProvider } from '../api/auth';
import { Button } from '../components/Button';

/**
 * The only way in: two buttons.
 *
 * There is no form to fill in, which recovers most of what the phone screen took
 * away — the first frame is one tap from a session again. What it does not
 * recover is anonymity: signing in tells Google or Facebook that you use this
 * app, and for an app about loneliness that is a real disclosure. The copy says
 * so rather than pretending otherwise, because a user finding that out later is
 * worse than a user deciding now.
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
      // The browser now owns the flow. The session arrives through the deep
      // link handler in App.tsx, so there is nothing to await here — and the
      // button stays disabled until the app is resumed, which is correct: a
      // second tap would start a second OAuth flow.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in.');
      setBusy(null);
    }
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top + TOKENS.space['2xl'] }]}>
      <View style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          {'Someone’s here\nto listen.'}
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Real people, ready to talk. Not therapy — just company.
        </Text>
      </View>

      <View style={styles.spacer} />

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

      {error !== null ? (
        <Text testID="auth-error" allowFontScaling style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Text allowFontScaling style={styles.legal}>
        We only ever read your name and email, and neither is shown to anyone you
        talk to — you choose a separate display name. Signing in does tell Google
        or Facebook that you use this app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: TOKENS.space.lg,
    backgroundColor: TOKENS.color.bg.base,
  },
  head: {
    paddingBottom: TOKENS.space['2xl'],
    gap: TOKENS.space['2xs'] + 2,
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
  error: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.primary,
    paddingTop: TOKENS.space.sm,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
    paddingTop: TOKENS.space.lg,
    paddingBottom: TOKENS.space['2xl'],
  },
});
