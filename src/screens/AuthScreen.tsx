import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TextField } from '../components/TextField';
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
import { useAuthUiConfig, FALLBACK_AUTH_UI } from '../api/appConfig';
import { normalisePhone } from '../lib/phone';
import { fadeSwap } from '../theme/motion';
import { Button } from '../components/Button';
import { CodeField } from '../components/CodeField';
import { Pressable } from '../components/Pressable';
import { Spinner } from '../components/Spinner';
import { CountryPicker, DEFAULT_DIAL_CODE } from '../components/CountryPicker';

/** How long "Resend code" stays unavailable. ADR-0009 §3. */
const RESEND_SECONDS = 30;

type Step = 'choose' | 'number' | 'confirm' | 'code';

/**
 * Two ways in, phone first.
 *
 * The ordering is the product decision, not a layout one. A phone number costs
 * money to replace and a Google account does not, so phone is the stronger
 * identity, and for an Indian audience it is also the more familiar one. Google
 * stays because it is instant and some people would rather not hand over a
 * number to an app about loneliness.
 *
 * What it still does not do is oversell. No illustration, no colour wash, no hero
 * image of a smiling stranger, the product's claim is that a real person will
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

  // Live auth UI config — falls back to compile-time defaults when offline.
  const { data: authUi = FALLBACK_AUTH_UI } = useAuthUiConfig();
  // PHONE_AUTH_ENABLED is also the per-provider compile-time gate (DLT registration).
  // Both must be true for phone sign-in to show.
  const phoneVisible = authUi.phone_auth_tab_visible && PHONE_AUTH_ENABLED;

  /**
   * One flag for two operations was a bug, not a shortcut.
   *
   * `'phone'` used to cover both "asking for a code" and "checking one", so
   * submitting a code made the *resend* button narrate 'Checking…'. They are
   * separate values now because two buttons read this and each may only speak
   * for itself.
   */
  const [busy, setBusy] = useState<SocialProvider | 'phone' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [step, setStep] = useState<Step>('choose');
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
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
   * the callback fails, the app goes signedOut -> signedOut, React reuses the
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
   * without a session, cancelled, denied, or a failed code exchange, and the
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
      // handler in App.tsx, so there is nothing to await, and `busy` stays set
      // deliberately: a second tap would start a second OAuth flow.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start sign-in.');
      setBusy(null);
    }
  }, []);

  /**
   * Actually send the OTP to the composed E.164 number and advance to `code`.
   *
   * Called from the 'confirm' step ("Yes, send code") and from the 'code' step
   * ("Resend code"). The 'number' step's "Send Code" button now calls
   * `showConfirm` instead, so the user can verify the number before we bill an
   * SMS.
   */
  const requestCode = useCallback(async () => {
    setError(null);
    setBusy('phone');
    const fullPhone = `${dialCode} ${phone.trim()}`;
    const result = await sendPhoneOtp(fullPhone);
    setBusy(null);
    if (result.status === 'failed') {
      setError(result.message);
      return;
    }
    sentTo.current = fullPhone;
    setCode('');
    setCooldown(RESEND_SECONDS);
    setStep('code');
  }, [dialCode, phone]);

  /** Advance to the confirm sub-step without sending an OTP. */
  const showConfirm = useCallback(() => {
    setError(null);
    setStep('confirm');
  }, []);

  /**
   * Submit. Called by CodeField the moment six digits exist, once per value.
   *
   * A wrong code bumps `errorNonce` and leaves the digits alone, the field
   * shakes and the user fixes one character. Clearing here would be the single
   * most disliked behaviour in an OTP flow.
   */
  const submitCode = useCallback(
    async (entered: string) => {
      setError(null);
      setBusy('verify');
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

  const fullPhone = `${dialCode} ${phone.trim()}`;
  const canSend = normalisePhone(fullPhone) !== null && busy === null;
  // On the code step, a code request can only have come from Resend.
  const resending = step === 'code' && busy === 'phone';
  const title = step === 'code' ? 'Enter the code' : "Someone's here to listen";
  // The number stays visible: "which number did I just type" is the question
  // people actually have at this moment.
  const subtitle = step === 'code' ? `Sent to ${dialCode} ${phone.trim()}.` : 'Real people, ready to talk.';

  return (
    /**
     * The keyboard used to cover the primary action.
     *
     * Tapping "Continue with phone" autofocuses the field, which opens the phone
     * pad straight over "Send code", the button you need next is the one you
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
          {/* Rule 7: the title cross-fades rather than cutting when the step
              changes, and the block reserves the taller of the two heights so the
              swap cannot reflow what is under it. Keyed on its own content, which
              is what makes the entrance run. Opacity only: no scale, no
              translate. */}
          <Animated.Text
            key={title}
            entering={fadeSwap}
            allowFontScaling
            style={styles.title}>
            {/* No forced line break and no terminal full stop: iOS display copy
                on an onboarding screen carries neither. */}
            {title}
          </Animated.Text>
          {step === 'choose' ? (
            /*
             * Three static claims, all legible at once.
             *
             * This was a WordCarousel: three lines with one lit and the others at
             * 10% opacity, cycling, taken from the Fuse reference. It was verified
             * on a device and reverted, because the arithmetic rules it out rather
             * than taste doing so. `text/secondary` on white is 7.41:1; composited
             * at 10% alpha it is 1.16:1, and it does not reach AA's 4.5 until alpha
             * 0.85, by which point the fade is imperceptible and the effect is
             * gone. So an opacity-driven focus and readable body copy are mutually
             * exclusive at this type size.
             *
             * The content made it worse rather than better. Fuse cycles decorative
             * single words; these are three substantive claims, and one of them is
             * "Not therapy, just company", which is this product's whole ethical
             * position. Making that unreadable two thirds of the time is the one
             * line here that must never be a design flourish.
             *
             * See design/references/motion-system.md for where rule 1 could still
             * live: a single rotating word inside the headline, which is what the
             * reference actually does.
             */
            <Animated.View entering={fadeSwap} style={styles.claims}>
              {[
                'Real people, not a chatbot',
                'Talk about anything, or nothing',
                'Not therapy, just company',
              ].map(claim => (
                <View key={claim} style={styles.claim}>
                  <View style={styles.claimDot} />
                  <Text allowFontScaling style={styles.claimText}>
                    {claim}
                  </Text>
                </View>
              ))}
            </Animated.View>
          ) : step === 'confirm' ? (
            <Animated.Text key={subtitle} entering={fadeSwap} allowFontScaling style={styles.subtitle}>
              Is this the correct number?
            </Animated.Text>
          ) : (
            <Animated.Text key={subtitle} entering={fadeSwap} allowFontScaling style={styles.subtitle}>
              {subtitle}
            </Animated.Text>
          )}
          {step === 'code' ? (
            <Pressable
              onPress={() => {
                setStep('number');
                setError(null);
              }}
              accessibilityLabel="Change phone number"
              testID="signin-change-number">
              <Text allowFontScaling style={styles.link}>
                Change Number
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>

        {step === 'number' ? (
          <Animated.View
            entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
            style={styles.field}>
            {/* CountryPicker leads the national number field. Default +91 for India. */}
            <CountryPicker
              value={dialCode}
              onChange={setDialCode}
              testID="signin-country"
            />
            <TextField
              testID="signin-phone-input"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="Your number"
              placeholderTextColor={theme.color.text.tertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                if (canSend) {
                  showConfirm();
                }
              }}
              accessibilityLabel="Phone number"
              style={styles.input}
            />
          </Animated.View>
        ) : null}

        {step === 'confirm' ? (
          <Animated.View
            entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
            style={styles.confirmBlock}>
            <Text allowFontScaling style={styles.confirmNumber}>
              {dialCode} {phone.trim()}
            </Text>
          </Animated.View>
        ) : null}

        {step === 'code' ? (
          <Animated.View
            entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
            style={styles.field}>
            {/* Deliberately not disabled while verifying.
                `editable={busy === null}` was the obvious thing and it undid the
                point of the whole component: disabling a focused TextInput blurs
                it, Android moves focus to the next focusable, the "Change
                number" button, which then wore a focus highlight, and the
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
        {step === 'choose' && phoneVisible ? (
          <Button
            label="Continue with Phone Number"
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
            label="Send Code"
            busy={busy === 'phone'}
            busyLabel="Sending code"
            onPress={() => {
              if (canSend) {
                showConfirm();
              }
            }}
            disabled={!canSend}
            testID="signin-send-code"
          />
        ) : null}

        {step === 'confirm' ? (
          <>
            {/*
             * Primary: actually sends the OTP once the user has confirmed their
             * number. White-pill style mirrors the OnboardingScreen primary.
             */}
            <Pressable
              testID="signin-confirm"
              accessibilityLabel="Yes, send code"
              onPress={() => {
                void requestCode();
              }}
              press="button"
              style={styles.confirmPrimary}
            >
              {busy === 'phone' ? (
                <Spinner size={20} color={theme.color.text.primary} />
              ) : (
                <Text allowFontScaling style={styles.confirmPrimaryLabel}>
                  Yes, send code
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="Edit number"
              onPress={() => {
                setStep('number');
                setError(null);
              }}
              press="button"
              style={styles.confirmSecondary}
            >
              <Text allowFontScaling style={styles.link}>
                Edit number
              </Text>
            </Pressable>
          </>
        ) : null}

        {step === 'code' ? (
          <Button
            // The cooldown is a genuine disabled state and stays one: the button
            // cannot be pressed and the label says when it can.
            //
            // It used to read 'Verifying…' here, which was a copy bug rather than
            // a style one. `busy` is set by BOTH requestCode and submitCode, so
            // entering a code made the RESEND button claim it was verifying. This
            // button only ever resends, so that is all it may narrate, and it
            // narrates it only while `resending` is what is actually happening.
            label={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
            busy={resending}
            busyLabel="Resending code"
            kind="secondary"
            onPress={() => {
              void requestCode();
            }}
            disabled={cooldown > 0 || busy !== null}
            testID="signin-resend"
          />
        ) : null}

        {/* Google is a bespoke white-pill button on every step that offers a
            choice. White fill / ink text matches the OnboardingScreen primary
            style; the G mark sits directly on white (its own brand rule).
            Full-width and always prominent, so it is never demoted to a
            secondary text link regardless of whether phone auth is enabled. */}
        {step === 'choose' ? (
          <Pressable
            testID="signin-google"
            accessibilityLabel={PROVIDER_LABEL.google}
            onPress={() => {
              void startSocial('google');
            }}
            press="button"
            style={styles.googlePill}
          >
            {busy === 'google' ? (
              <Spinner size={20} color={theme.color.text.primary} />
            ) : (
              <>
                <Image
                  source={require('../../assets/brands/google.png')}
                  style={styles.googleMark}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
                <Text allowFontScaling style={styles.googlePillLabel}>
                  {PROVIDER_LABEL.google}
                </Text>
              </>
            )}
          </Pressable>
        ) : null}
      </Animated.View>

      <Animated.Text
        entering={FadeIn.delay(320).duration(TOKENS.motion.duration.base)}
        allowFontScaling
        style={styles.legal}>
        {step === 'choose'
          ? phoneVisible
            ? 'Your number is never shown to anyone you talk to. You pick a separate display name. Signing in with Google instead tells Google that you use this app.'
            : 'We only read your name and email, and neither is shown to anyone you talk to. You pick a separate display name. Signing in does tell Google that you use this app.'
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
    // Two lines reserved, derived rather than typed. 'Someone's here to listen'
    // wraps at 34pt and 'Enter the code' does not, so without this the whole head
    // block jumps a line high the moment the step changes, and under a cross-fade
    // that is worse than a hard cut, because the movement happens while the text
    // is half transparent.
    minHeight: TOKENS.typography.displayLarge.lineHeight * 2,
  },
  claims: {
    gap: TOKENS.space.xs,
  },
  claim: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
  },
  // A bullet, not a lit/dim state. The mark is the same on every row because
  // every row is equally true.
  claimDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.color.text.tertiary,
  },
  claimText: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
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
  },
  field: {
    gap: TOKENS.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.bg.sunken,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    paddingHorizontal: TOKENS.space.md,
    height: 48,
  },
  input: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.primary,
    flex: 1,
  },
  // Confirm sub-step: display the formatted number prominently.
  confirmBlock: {
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  confirmNumber: {
    ...TOKENS.typography.displayLarge,
    color: t.color.text.primary,
    textAlign: 'center',
  },
  // Primary confirm pill: white fill / ink text, full-width.
  confirmPrimary: {
    flexDirection: 'row',
    gap: TOKENS.space.xs,
    height: 48,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  confirmPrimaryLabel: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
  },
  // "Edit number" ghost link.
  confirmSecondary: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bespoke Google button: white pill / ink text / direct G mark.
  // Always full-width and visually primary regardless of phone auth state.
  googlePill: {
    flexDirection: 'row',
    gap: TOKENS.space.xs,
    height: 48,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  googleMark: {
    width: 20,
    height: 20,
  },
  googlePillLabel: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
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
