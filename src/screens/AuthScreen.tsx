import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  PHONE_AUTH_ENABLED,
  PROVIDER_LABEL,
  sendPhoneOtp,
  signInWith,
  verifyPhoneOtp,
  type SocialProvider,
} from '../api/auth';
import { normalisePhone } from '../lib/phone';
import { Button } from '../components/Button';
import { CodeField } from '../components/CodeField';
import { Pressable } from '../components/Pressable';

/** How long "Resend code" stays unavailable. ADR-0009 §3. */
const RESEND_SECONDS = 30;

type Step = 'choose' | 'number' | 'code';

/**
 * Two ways in, phone first.
 *
 * The ordering is the product decision, not a layout one. A phone number costs
 * money to replace and a Google account does not, so phone is the stronger
 * identity — and for an Indian audience it is also the more familiar one. Google
 * stays because it is instant and some people would rather not hand over a
 * number to an app about loneliness.
 *
 * What it still does not do is oversell. No illustration, no colour wash, no hero
 * image of a smiling stranger — the product's claim is that a real person will
 * listen, and a stock photograph would undercut it on the first screen.
 *
 * (Avoiding a certain g-word literally: the accent-budget test bans it anywhere
 * in src/components and src/screens, comments included, which is the right kind
 * of blunt.)
 */
export function AuthScreen({ initialError }: { initialError?: string }) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [busy, setBusy] = useState<SocialProvider | 'phone' | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [step, setStep] = useState<Step>('choose');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const sentTo = useRef('');

  /**
   * Adopt a message handed down from a failed OAuth callback.
   *
   * `useState(initialError)` alone is not enough and that was a real bug: the
   * initialiser runs only on first mount, and this screen is already mounted when
   * the callback fails — the app goes signedOut -> signedOut, React reuses the
   * instance, and the explanation is silently dropped. Which is how a fixed
   * "show the user why" ends up showing nothing.
   */
  useEffect(() => {
    if (initialError != null && initialError !== '') {
      setError(initialError);
    }
  }, [initialError]);

  /**
   * Clear `busy` whenever the app comes back to the foreground.
   *
   * Without this the screen bricks itself: hand off to the browser, come back
   * without a session — cancelled, denied, or a failed code exchange — and the
   * button sits on "Opening…" disabled forever. Observed on a real emulator by
   * firing the callback with an invalid code; the only way out was killing the
   * app. Returning to this screen at all means sign-in did not complete, because
   * a success unmounts it, so "foreground" is exactly the right signal.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setBusy(null);
      }
    });
    return () => sub.remove();
  }, []);

  /** Resend countdown. A tappable button that does nothing teaches distrust. */
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const startSocial = useCallback(async (provider: SocialProvider) => {
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

  const requestCode = useCallback(async () => {
    setError(null);
    setBusy('phone');
    const result = await sendPhoneOtp(phone);
    setBusy(null);
    if (result.status === 'failed') {
      setError(result.message);
      return;
    }
    sentTo.current = phone;
    setCode('');
    setCooldown(RESEND_SECONDS);
    setStep('code');
  }, [phone]);

  /**
   * Submit. Called by CodeField the moment six digits exist, once per value.
   *
   * A wrong code bumps `errorNonce` and leaves the digits alone — the field
   * shakes and the user fixes one character. Clearing here would be the single
   * most disliked behaviour in an OTP flow.
   */
  const submitCode = useCallback(
    async (entered: string) => {
      setError(null);
      setBusy('phone');
      const result = await verifyPhoneOtp(sentTo.current, entered);
      setBusy(null);
      if (result.status === 'failed') {
        setError(result.message);
        setErrorNonce(n => n + 1);
        return;
      }
      // Success unmounts this screen: App.tsx is subscribed to the session.
    },
    [],
  );

  const canSend = normalisePhone(phone) !== null && busy === null;
  const pretty = phone.trim() === '' ? '' : `+${normalisePhone(phone) ?? phone}`;

  return (
    /**
     * The keyboard used to cover the primary action.
     *
     * Tapping "Continue with phone" autofocuses the field, which opens the phone
     * pad straight over "Send code" — the button you need next is the one you
     * cannot see. The manifest already asks for `adjustResize`, and that is not
     * enough here: the app draws edge to edge, and edge-to-edge windows stop
     * getting the automatic resize on newer Android.
     *
     * `height` on Android rather than `padding`: with padding the root keeps its
     * full height and the inset pushes content off the bottom instead of
     * compressing it, which moves the problem rather than fixing it.
     */
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[
        styles.root,
        { paddingTop: insets.top + TOKENS.space['2xl'], paddingBottom: insets.bottom },
      ]}>
      <View style={styles.middle}>
        <Animated.View
          entering={FadeInDown.delay(80).duration(TOKENS.motion.duration.base)}
          style={styles.head}>
          <Text allowFontScaling style={styles.title}>
            {step === 'code' ? 'Enter the code.' : 'Someone’s here\nto listen.'}
          </Text>
          <Text allowFontScaling style={styles.subtitle}>
            {step === 'code'
              ? // The number stays visible: "which number did I just type" is the
                // question people actually have at this moment.
                `Sent to ${pretty}.`
              : 'Real people, ready to talk. Not therapy — just company.'}
          </Text>
          {step === 'code' ? (
            <Pressable
              onPress={() => {
                setStep('number');
                setError(null);
              }}
              accessibilityLabel="Change phone number"
              testID="signin-change-number">
              <Text allowFontScaling style={styles.link}>
                Change number
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>

        {step === 'number' ? (
          <Animated.View
            entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
            style={styles.field}>
            {/* +91 is shown and still editable. A hard-locked country code is a
                bug for anyone travelling or holding a foreign number. */}
            <TextInput
              testID="signin-phone-input"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="+91 98765 43210"
              placeholderTextColor={theme.color.text.tertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (canSend) {
                  void requestCode();
                }
              }}
              accessibilityLabel="Phone number"
              style={styles.input}
            />
          </Animated.View>
        ) : null}

        {step === 'code' ? (
          <Animated.View
            entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
            style={styles.field}>
            {/* Deliberately not disabled while verifying.
                `editable={busy === null}` was the obvious thing and it undid the
                point of the whole component: disabling a focused TextInput blurs
                it, Android moves focus to the next focusable — the "Change
                number" button, which then wore a focus highlight — and the
                keyboard closes. So a rejected code left the six digits on screen
                and no way to edit one without tapping back in, which is the
                behaviour this design exists to avoid.

                Nothing is needed in its place: CodeField only fires onComplete
                once per distinct value, so a slow network cannot double-submit,
                and maxLength stops a seventh digit. */}
            <CodeField
              testID="signin-code-input"
              value={code}
              onChange={setCode}
              onComplete={submitCode}
              errorNonce={errorNonce}
            />
          </Animated.View>
        ) : null}
      </View>

      {/* Above the actions, not below: an explanation for why sign-in failed
          belongs next to the button you are about to press again, and the bottom
          of the screen is where the dev warning toast and the system nav bar both
          live. */}
      {error !== null ? (
        <Text testID="auth-error" allowFontScaling style={styles.error}>
          {error}
        </Text>
      ) : null}

      {/* The gap lives on the container, not as margins on the buttons, so the
          Button component stays reusable inside sheets that set their own rhythm. */}
      <Animated.View
        entering={FadeInDown.delay(160).duration(TOKENS.motion.duration.base)}
        style={styles.actions}>
        {step === 'choose' && PHONE_AUTH_ENABLED ? (
          <Button
            label="Continue with phone"
            onPress={() => {
              setError(null);
              setStep('number');
            }}
            disabled={busy !== null}
            testID="signin-phone"
          />
        ) : null}

        {step === 'number' ? (
          <Button
            label={busy === 'phone' ? 'Sending…' : 'Send code'}
            onPress={() => {
              void requestCode();
            }}
            disabled={!canSend}
            testID="signin-send-code"
          />
        ) : null}

        {step === 'code' ? (
          <Button
            label={
              cooldown > 0
                ? `Resend in ${cooldown}s`
                : busy === 'phone'
                  ? 'Checking…'
                  : 'Resend code'
            }
            kind="secondary"
            onPress={() => {
              void requestCode();
            }}
            disabled={cooldown > 0 || busy !== null}
            testID="signin-resend"
          />
        ) : null}

        {/* Google is the second option on every step that offers a choice. Not
            hidden — some people would rather not give a number to an app about
            loneliness — but not first either, because a Google account is free to
            replace and a number is not. */}
        {step === 'choose' ? (
          <Button
            label={busy === 'google' ? 'Opening…' : PROVIDER_LABEL.google}
            kind={PHONE_AUTH_ENABLED ? 'secondary' : 'primary'}
            onPress={() => {
              void startSocial('google');
            }}
            disabled={busy !== null}
            testID="signin-google"
          />
        ) : null}
      </Animated.View>

      <Animated.Text
        entering={FadeIn.delay(320).duration(TOKENS.motion.duration.base)}
        allowFontScaling
        style={styles.legal}>
        {step === 'choose'
          ? PHONE_AUTH_ENABLED
            ? 'Your number is never shown to anyone you talk to — you pick a separate display name. Signing in with Google instead tells Google that you use this app.'
            : 'We only read your name and email, and neither is shown to anyone you talk to — you pick a separate display name. Signing in does tell Google that you use this app.'
          : 'Standard message rates may apply. The code expires in 2 minutes.'}
      </Animated.Text>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: TOKENS.space.lg,
    backgroundColor: t.color.bg.base,
  },
  middle: {
    flex: 1,
    justifyContent: 'center',
    gap: TOKENS.space.xl,
  },
  head: {
    gap: TOKENS.space.sm,
  },
  title: {
    ...TOKENS.typography.displayLarge,
    color: t.color.text.primary,
  },
  subtitle: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
  // Secondary, not accent: "Change number" is a small correction, and the
  // primary action on this step is the code field itself.
  link: {
    ...TOKENS.typography.labelMedium,
    color: t.color.text.secondary,
    textDecorationLine: 'underline',
  },
  field: {
    gap: TOKENS.space.sm,
  },
  input: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.primary,
    backgroundColor: t.color.bg.raised,
    borderWidth: 1,
    borderColor: t.color.border.strong,
    borderRadius: TOKENS.radius.md,
    paddingHorizontal: TOKENS.space.md,
    height: 56,
  },
  // The fix for "buttons have no gap".
  actions: {
    gap: TOKENS.space.sm,
  },
  error: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.primary,
    paddingBottom: TOKENS.space.sm,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
    paddingTop: TOKENS.space.xl,
    paddingBottom: TOKENS.space.xl,
  },
});
