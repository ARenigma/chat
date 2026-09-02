import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { BLOOM_CONTENT_MS, BLOOM_FIELD_MS, BLOOM_HOLD_MS, stepTint } from '../lib/bloom';
import {
  COMPLETION_DELAY_MS,
  SOURCE_METRICS,
  STEP_ADVANCE_MS,
  STEP_EXIT_MS,
  canSubmit,
  coresCollapsed,
  paletteFor,
  visibleSteps,
  type FieldState,
  type IdentifyStage,
  type Phase,
  type Route,
} from '../lib/onboarding';
import { BloomField } from '../components/BloomField';
import { OnboardingStep } from '../components/OnboardingStep';
import { WordColumn, type Word } from '../components/WordColumn';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { CodeField } from '../components/CodeField';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { CompletionRow } from '../components/CompletionRow';
import { TextField } from '../components/TextField';
import { CountryPicker, DEFAULT_DIAL_CODE } from '../components/CountryPicker';
import { useStore } from '../store/useStore';
import {
  GoogleCredentialError,
  PHONE_AUTH_ENABLED,
  sendPhoneOtp,
  signInWithGoogle,
  verifyPhoneOtp,
} from '../api/auth';
import {
  AGE_BRACKETS,
  getSignedInProfile,
  isFirstUser,
  needsAgeBracket,
  setMemberAgeBracket,
  type AgeBracket,
} from '../api/profileSetup';

const BLOCK_PAD = SOURCE_METRICS.blockPad;
const COLUMN_TOP = SOURCE_METRICS.columnTop;
const COLUMN_INSET = SOURCE_METRICS.columnInset;

/** How long "Resend code" stays unavailable after an OTP is sent. */
const RESEND_SECONDS = 30;

/*
 * Five single words, each with its own mark and its own colour.
 *
 * **Single words, because the reference is single words.** Fuse runs Pay,
 * Invest, Spend, Earn, Save — one noun or verb each, set at 40pt. This shipped
 * first with "Say it out loud" and "Be heard" in the same slot, and a four-word
 * phrase at that size does something the reference never does: it wraps, or it
 * shrinks, and either way the row stops being a word and becomes a sentence.
 * The column is a rhythm of single beats.
 *
 * **Five, not four.** The window renders five rows, so a list of four repeats
 * one of them inside the window at any moment. It landed on an edge row that is
 * nearly transparent, which is why it was survivable, but five words means
 * every visible row is a different word.
 *
 * **Built from the theme rather than declared as a module constant.** The mark
 * colours happen to be identical in light and dark, so reading them straight
 * off `TOKENS` would work today and a contract test correctly refuses it: the
 * rule exists so no colour can become mode-blind by accident, and an exception
 * for the ones that are currently mode-agnostic is exactly how that rot starts.
 */
function useWords(): readonly Word[] {
  const theme = useTheme();
  return useMemo(
    () => [
      { text: 'Talk', glyph: 'chat', color: theme.color.mark.talk },
      /*
       * Not `phone` for Listen, which is the obvious pick and is wrong here.
       * That glyph's handset end-caps are sized off stroke weight rather than
       * the box, so beside a 40pt word all that survives is the rotated arc and
       * it reads as a smile. Fine in the tab bar where a label disambiguates it,
       * and that is shared code this screen has no business reshaping.
       */
      {
        text: 'Listen',
        glyph: 'listen',
        color: theme.color.mark.listen,
      },
      { text: 'Vent', glyph: 'vent', color: theme.color.mark.vent },
      { text: 'Share', glyph: 'share', color: theme.color.mark.share },
      { text: 'Unwind', glyph: 'unwind', color: theme.color.mark.unwind },
    ],
    [theme],
  );
}

interface Props {
  /** Called once the member has a session and the completion beat has played. */
  onDone: () => void;
}

/**
 * The entire onboarding, on one screen, built from `OnboardingFlow.swift`.
 *
 * **Nothing here navigates.** The field mounts once and lives through every
 * phase; the welcome content, the checklist and the completion row are all
 * transitions over the same surface. That is the reference's whole architecture
 * and it is the first thing a rewrite would destroy by reaching for a navigator.
 * The 1.2 second stretch after Continue, where the field is alone on screen with
 * no content at all, is not dead time — it is the transition, and removing it
 * saves a second and loses the effect.
 *
 * **Google OR phone, never both.** The source's three steps are sequential
 * because a wallet needs all three keys. Ours are alternatives, so the checklist
 * grows a second row only on the phone route. See `visibleSteps`.
 */
export function OnboardingScreen({ onDone }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const words = useWords();
  const setPendingProviderApply = useStore(s => s.setPendingProviderApply);

  const [phase, setPhase] = useState<Phase>('welcome');
  const [route, setRoute] = useState<Route>('undecided');
  const [identify, setIdentify] = useState<IdentifyStage>('choose');
  const [state, setState] = useState<FieldState>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [dialCode, setDialCode] = useState(DEFAULT_DIAL_CODE);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  // True once an OTP has been sent for the current number, so the code row stays
  // navigable — you can tap back to "Your number" and tap the code row to return.
  const [otpSent, setOtpSent] = useState(false);
  // True after a resend, so we can tell the user the previous code stopped
  // working — a commonly-missed line that otherwise reads as a silent failure
  // when someone keeps trying the first code (OTP-UX research, 2026-09-03).
  const [resent, setResent] = useState(false);

  /*
   * Auth-done flag: raised once Google or phone verification succeeds.
   *
   * Separates the "auth completed" event from `finish()` so the age step can
   * live between them. The flag appends the age row to the visible checklist and
   * switches the active step to 'age'. The field's colour follows the sub-stage,
   * so it turns over here too — see `paletteFor`.
   *
   * The browser-redirect path never reaches this flag: the screen unmounts
   * before auth settles, and App.tsx's boot machine handles age collection via
   * ProfileSetupScreen instead. This flag is exclusively for the Credential
   * Manager path, which resolves synchronously and stays on screen.
   */
  const [authDone, setAuthDone] = useState(false);
  const [selectedBracket, setSelectedBracket] = useState<AgeBracket | null>(null);

  /*
   * The IME is part of the layout, not something to draw behind.
   *
   * Android's layout guidance treats the keyboard as a first-class occupant of
   * the window, and the manifest already asks for `adjustResize`. That alone was
   * not enough here: React Native 0.86 runs edge-to-edge by default, where the
   * window no longer shrinks, and the form is absolutely positioned on top of the
   * field — so the phone input sat underneath the keyboard with nothing to push
   * it up. `KeyboardAvoidingView` below does the lifting; this flag also takes
   * the field off screen, which is what the source does and what leaves the
   * remaining third of the display to the one question being asked.
   */
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    // `Did` rather than `Will` on Android: the `Will` events are iOS-only and
    // never fire here, so a `Will`-only listener silently does nothing.
    const show = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardUp(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /** Resend countdown. A tappable button that does nothing teaches distrust. */
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown(s => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /*
   * The field's clock, in milliseconds, driven LINEARLY.
   *
   * The easing lives per layer in `layerProgress`, not here, because each layer
   * runs its own 500ms curve from its own start time. Easing this value would
   * apply one curve across all three and destroy the stagger that is the effect.
   */
  const elapsed = useSharedValue(0);
  const welcomeOut = useSharedValue(0);
  /*
   * The form's arrival, 0..1. Driven from `begin()` at the handoff rather than
   * with an `entering` preset, because the form is MOUNTED at the press (see
   * `showForm`) and only shown at `BLOOM_HOLD_MS`; an `entering` animation runs
   * at mount, which is the wrong moment.
   */
  const formIn = useSharedValue(0);

  const steps = useMemo(
    () => visibleSteps(route, { includeAge: authDone }),
    [route, authDone],
  );
  // The identify sub-stage IS the active step key now (choose / number / code),
  // so the checklist rows are real steps rather than one "Say hello" catch-all.
  const activeKey = authDone ? 'age' : identify;
  // Colour follows the SUB-STAGE, so the field turns over on every tap rather
  // than only when the checklist grows a row. See `paletteFor`.
  const stage = useMemo(
    () => ({
      palette: paletteFor(phase, identify),
      collapsed: coresCollapsed(phase),
    }),
    [phase, identify],
  );

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(
    () => () => {
      for (const t of timers.current) {
        clearTimeout(t);
      }
    },
    [],
  );

  /** Continue: the welcome content leaves, the field turns over, then the form. */
  const begin = useCallback(() => {
    if (phase !== 'welcome') {
      return;
    }
    setPhase('leaving');
    elapsed.value = withTiming(BLOOM_FIELD_MS, {
      duration: BLOOM_FIELD_MS,
      easing: Easing.linear,
    });
    welcomeOut.value = withTiming(1, {
      duration: BLOOM_CONTENT_MS,
      easing: Easing.inOut(Easing.quad),
    });
    // The source hands off at `now + 1.2`, measured from the press rather than
    // from the end of the content transition. The form then arrives with
    // `withAnimation(.smooth)` — 0.5s — as `.opacity.combined(with: .offset(y: 20))`.
    after(BLOOM_HOLD_MS, () => {
      setPhase('form');
      formIn.value = withTiming(1, {
        duration: STEP_ADVANCE_MS,
        easing: Easing.inOut(Easing.quad),
      });
    });
  }, [phase, elapsed, welcomeOut, formIn, after]);

  /*
   * Hand off to the completion row and stop owning the timing.
   *
   * `CompletionRow` runs its own working-then-done beat and calls `onDone`
   * itself, which is the source's shape: `CompletionStep` awaits its work, flips
   * to completed, then schedules `onComplete`. Keeping a timer here as well
   * would race it, and whichever fired first would win.
   */
  const finish = useCallback(() => {
    setPhase('done');
  }, []);

  const fail = useCallback((message: string) => {
    setState('error');
    setFailure(message);
    setErrorNonce(n => n + 1);
  }, []);

  const completeAuthentication = useCallback(async () => {
    const profile = await getSignedInProfile();
    const collectAge =
      isFirstUser(profile ?? undefined) &&
      needsAgeBracket(profile ?? undefined);

    setState('success');
    after(STEP_ADVANCE_MS, () => {
      if (collectAge) {
        setState('idle');
        setAuthDone(true);
      } else {
        finish();
      }
    });
  }, [after, finish]);

  const onGoogle = useCallback(() => {
    if (!canSubmit(state)) {
      return;
    }
    setRoute('google');
    setState('loading');
    setFailure(null);
    /*
     * The source's `keyboardShown = false` inside `submitCurrentStep`. Without
     * it the keyboard stays up over the result of the thing just submitted,
     * which on a short window is most of the screen.
     */
    Keyboard.dismiss();
    void (async () => {
      try {
        const result = await signInWithGoogle();
        if (result === 'redirected') {
          /*
           * Deliberately stays in `loading` and does NOT call `finish`.
           *
           * The browser path resolves the moment the browser is up, long before
           * anyone has consented. Treating that as success advances to a
           * signed-in tree with no session and every query there hangs — a bug
           * that has already shipped here once. The session arrives through
           * `handleAuthDeepLink`, App re-renders, and this screen unmounts.
           * Credential Manager will return `session` instead and fall through.
           */
          return;
        }
        // Funded members are existing users even when an old profile migration
        // left nullable fields behind. Only a zero-wallet member sees age.
        await completeAuthentication();
      } catch (error) {
        setRoute('undecided');
        if (
          error instanceof GoogleCredentialError &&
          error.reason === 'cancelled'
        ) {
          /*
           * Silent, deliberately. Dismissing the sheet is a decision, not a
           * fault, and "Sign-in failed" under a sheet somebody tapped away from
           * is the kind of small lie that makes an app feel broken. Reset to
           * idle so the button is live again and say nothing.
           */
          setState('idle');
          return;
        }
        fail(
          error instanceof Error
            ? error.message
            : 'Could not sign in with Google.',
        );
      }
    })();
  }, [state, fail, completeAuthentication]);

  const onUsePhone = useCallback(() => {
    setRoute('phone');
    setIdentify('number');
    setState('idle');
    setFailure(null);
  }, []);

  /**
   * "Become a partner": store the intent, then trigger Google sign-in.
   * App.tsx reads `pendingProviderApply` after auth completes and routes to 'apply'.
   */
  const onBecomePartner = useCallback(() => {
    setPendingProviderApply(true);
    onGoogle();
  }, [setPendingProviderApply, onGoogle]);

  /*
   * The source's `isValid`, which is `!value.isEmpty`. Ours asks for a little
   * more because an Indian mobile number is ten digits and a one-character
   * "valid" would enable a submit that the server is certain to reject.
   */
  const canSend = phone.trim().length >= 6 && state !== 'loading';

  /** Send directly; OTP verification is the confirmation, so no second prompt. */
  const onSendCode = useCallback(() => {
    if (!canSend || !canSubmit(state)) {
      return;
    }
    Keyboard.dismiss();
    setState('loading');
    setFailure(null);
    const fullPhone = `${dialCode} ${phone.trim()}`;
    void (async () => {
      const result = await sendPhoneOtp(fullPhone);
      if (result.status !== 'failed') {
        setState('idle');
        setIdentify('code');
        setOtpSent(true);
        setResent(false);
        setCooldown(RESEND_SECONDS);
        return;
      }
      fail(result.message);
    })();
  }, [canSend, state, dialCode, phone, fail]);

  /** Resend the OTP from the code-entry stage, respecting the cooldown. */
  const onResend = useCallback(() => {
    if (cooldown > 0 || !canSubmit(state)) {
      return;
    }
    setState('loading');
    setFailure(null);
    const fullPhone = `${dialCode} ${phone.trim()}`;
    void (async () => {
      const result = await sendPhoneOtp(fullPhone);
      if (result.status !== 'failed') {
        setState('idle');
        setResent(true);
        setCooldown(RESEND_SECONDS);
        return;
      }
      fail(result.message);
    })();
  }, [cooldown, state, dialCode, phone, fail]);

  const onChangeNumber = useCallback(() => {
    setCode('');
    setFailure(null);
    setResent(false);
    setState('idle');
    setIdentify('number');
  }, []);

  /**
   * Jump to an earlier, already-answered step — tapping its collapsed row, or the
   * system back gesture. Preserves what was entered so a round-trip between number
   * and code keeps the digits; re-choosing the method drops the phone route so the
   * Google/number options reappear.
   */
  const goToStep = useCallback((key: IdentifyStage) => {
    setFailure(null);
    setState('idle');
    if (key === 'choose') {
      setRoute('undecided');
      setOtpSent(false);
    }
    setIdentify(key);
  }, []);

  /**
   * Back steps THROUGH the flow (code → number → choose) instead of leaving it,
   * so the turn-by-turn morph is reversible. From the choose row or the welcome
   * the system default runs, so the app can still be dismissed. RULE 1: RN 0.86
   * opts into the predictive-back callback at targetSdk 36, so returning true is
   * what consumes the press.
   */
  useEffect(() => {
    const onBack = (): boolean => {
      if (phase === 'done' || authDone) {
        return false;
      }
      if (identify === 'code') {
        goToStep('number');
        return true;
      }
      if (identify === 'number') {
        goToStep('choose');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [phase, authDone, identify, goToStep]);

  const onVerify = useCallback(
    (entered: string) => {
      if (!canSubmit(state)) {
        return;
      }
      setState('loading');
      setFailure(null);
      const fullPhone = `${dialCode} ${phone.trim()}`;
      void (async () => {
        const result = await verifyPhoneOtp(fullPhone, entered);
        if (result.status !== 'failed') {
          // Keep the IME stable while verification is pending, then dismiss it
          // before the post-auth age step replaces the code field.
          Keyboard.dismiss();
          await completeAuthentication();
          return;
        }
        fail(result.message);
      })();
    },
    [state, dialCode, phone, fail, completeAuthentication],
  );

  /**
   * Age bracket confirmed: save to Supabase then complete onboarding.
   *
   * Called either from the "Continue" button in the age control block, or when
   * the member taps a chip (auto-advance). The RPC is idempotent, so a retry on
   * a transient error is safe.
   */
  const onSubmitAge = useCallback(() => {
    if (selectedBracket === null || !canSubmit(state)) {
      return;
    }
    setState('loading');
    setFailure(null);
    void (async () => {
      try {
        await setMemberAgeBracket(selectedBracket);
        setState('success');
        finish();
      } catch (err) {
        fail(err instanceof Error ? err.message : 'Could not save age. Please try again.');
      }
    })();
  }, [selectedBracket, state, finish, fail]);

  /*
   * `.transition(.opacity.combined(with: .offset(y: 20)))` from the source: the
   * welcome content does not just fade, it settles 20pt downward as it goes.
   */
  const welcomeStyle = useAnimatedStyle(() => ({
    opacity: 1 - welcomeOut.value,
    transform: [{ translateY: welcomeOut.value * 20 }],
  }));

  const formStyle = useAnimatedStyle(() => ({
    opacity: formIn.value,
    transform: [{ translateY: (1 - formIn.value) * 20 }],
  }));

  const showWelcome = phase === 'welcome' || phase === 'leaving';
  /*
   * The form is MOUNTED at the Continue press and SHOWN at the 1.2s handoff.
   *
   * Mounting it is the heaviest commit in the flow — the keyboard host, the
   * scroll view, the checklist, the Google mark — and it used to land at
   * `BLOOM_HOLD_MS`, fifty milliseconds after the last layer came to rest,
   * exactly where a dropped frame is most visible. Between the press and 400ms
   * no layer moves (every stagger delay is ≥400ms), so the commit lands there
   * instead, invisible under a field that is only fading its content. Nothing
   * about the 1.2s hold changes: `formReady` still flips at `BLOOM_HOLD_MS`,
   * and until then the subtree is transparent, untouchable and hidden from
   * TalkBack.
   */
  const showForm = phase !== 'welcome';
  const formReady = phase === 'form' || phase === 'done';

  return (
    <View style={styles.root}>
      <BloomField elapsed={elapsed} stage={stage} hidden={keyboardUp} />

      {showWelcome ? (
        /*
         * A flex COLUMN, not two absolutely-positioned boxes.
         *
         * It was two absolute boxes — carousel pinned to `top: insets.top + 120`,
         * CTA block pinned to `bottom: 0` — which is what the reference does on a
         * 914dp iPhone where they cannot meet. On the minSdk floor they meet:
         * API 24's emulator is 411x731dp, 183dp shorter, and the carousel landed
         * on top of the wordmark. Verified on device 2026-08-26; every screenshot
         * before that was 914dp, so nothing had ever shown it.
         *
         * 16:9 is not a rounding error for this product — it is most of the older
         * Xiaomi/Oppo/Vivo install base in India. Flex means the two regions
         * divide whatever height exists and can never overlap at any size, which
         * is what the adaptive-layout guidance asks for instead of fixed offsets.
         */
        <View style={styles.welcome} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.column,
              { marginTop: insets.top + COLUMN_TOP },
              welcomeStyle,
            ]}
          >
            <WordColumn words={words} paused={phase !== 'welcome'} testID="welcome-words" />
          </Animated.View>

          <Animated.View
            style={[
              styles.block,
              { paddingBottom: BLOCK_PAD + insets.bottom },
              welcomeStyle,
            ]}
          >
            {/*
             * The app icon, then the wordmark, then the website line — the same
             * anatomy as Fuse's WelcomeScreen (logo → title → description,
             * `WelcomeScreen.swift:31-44`), carrying our content instead of theirs.
             * The icon is the real Pappal app icon in its box (the dark rounded
             * tile, coral+white mark) at Fuse's exact `frame(width: 50)` — the box
             * is what lets the coral bar survive against the coral bloom, which a
             * bare transparent mark cannot. Rounded as a continuous squircle so it
             * reads as the launcher tile, not a pasted square.
             */}
            <View style={styles.markShadow}>
              <Image
                source={require('../../assets/brand/app-icon.png')}
                style={styles.mark}
                resizeMode="contain"
                accessibilityLabel="Pappal"
              />
            </View>
            <Text allowFontScaling={false} style={styles.brand}>
              Pappal
            </Text>
            <Text allowFontScaling style={styles.subtitle}>
              Positive conversations, made simple.
            </Text>
            {/*
             * No `busy` prop, deliberately, and the contract test is right to
             * ask. That rule exists so an async button narrates what it started.
             * Here the narration IS the screen: the whole surface fades and the
             * field turns over the instant this is pressed, which no participle
             * could improve on. Double-fire is prevented by the guard in
             * `begin` rather than by disabling the control.
             */}
            <Pressable
              onPress={begin}
              testID="welcome-continue"
              accessibilityLabel="Continue"
              press="button"
              style={styles.cta}
            >
              <Text allowFontScaling style={styles.ctaLabel}>
                Continue
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}

      {showForm ? (
        <KeyboardAvoidingView
          style={styles.formHost}
          // `height` on Android and `padding` on iOS, matching AuthScreen and
          // ChatScreen. Android's `padding` behaviour double-counts against
          // `adjustResize`; `height` resizes the container, which is what a
          // bottom-anchored block needs.
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents={formReady ? 'auto' : 'none'}
          importantForAccessibility={formReady ? 'auto' : 'no-hide-descendants'}
        >
          {/*
           * Scrollable, because a window can be shorter than the content.
           *
           * Removing the portrait lock is what made this necessary and it is not
           * optional: at 2400x1080 with the keyboard up there are roughly 300dp
           * of usable height, and a bottom-anchored block that cannot scroll
           * simply loses its top — the step title ended up behind the status
           * bar. Android's layout guidance treats a window that cannot show its
           * content as a layout bug rather than a device problem.
           *
           * `contentContainerStyle` carries `flexGrow: 1` so the form still
           * fills a tall window and keeps its bottom anchoring; without it the
           * block collapses to its content height and floats at the top in
           * portrait, which is the usual way this fix breaks the common case.
           *
           * `keyboardShouldPersistTaps="handled"` so the submit button can be
           * tapped while the field has focus, rather than the first tap being
           * eaten to dismiss the keyboard.
           */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              phase === 'done' ? styles.formCentred : styles.formBottom,
              {
                paddingBottom: BLOCK_PAD + (keyboardUp ? 0 : insets.bottom),
                paddingTop: BLOCK_PAD + insets.top,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View
              style={[
                styles.form,
                phase === 'done' ? styles.formCentred : styles.formBottom,
                formStyle,
              ]}
            >
              {/*
               * The checklist, and then the control BELOW it — the source's
               * structure, not a rearrangement.
               *
               * `MultiStepForm` is
               * `VStack(spacing: 64) { VStack(spacing: 32) { steps }, control }`.
               * The control is a sibling of the whole list, so it holds its place
               * at the bottom of the screen while rows above it expand and
               * collapse. Nesting it inside the active step, which is what this
               * shipped with first, makes the button jump every time the list
               * changes shape, and on the phone route it put the submit above a
               * greyed-out row instead of beneath everything.
               */}
              <View style={styles.checklist}>
                {steps.map(spec => {
                  // A row is tappable to jump to it once it is reachable: the
                  // choose row always, "Your number" once the phone route is taken,
                  // "Your code" once an OTP has been sent (so a collapsed code row
                  // re-expands on a tap). The active row and the post-auth age row
                  // are never back targets.
                  const reachable =
                    phase !== 'done' &&
                    !authDone &&
                    spec.key !== activeKey &&
                    (spec.key === 'choose' ||
                      (spec.key === 'number' && route === 'phone') ||
                      (spec.key === 'code' && otpSent));
                  const row = (
                    <OnboardingStep
                      step={spec}
                      expanded={phase !== 'done' && spec.key === activeKey}
                      accent={stepTint(spec.key)}
                      hideIcon
                      testID={`step-${spec.key}`}
                    />
                  );
                  return reachable ? (
                    <Pressable
                      key={spec.key}
                      onPress={() => goToStep(spec.key as IdentifyStage)}
                      press="none"
                      highlight="ios"
                      accessibilityLabel={`Go to ${spec.title}`}
                      testID={`step-nav-${spec.key}`}>
                      {row}
                    </Pressable>
                  ) : (
                    <View key={spec.key}>{row}</View>
                  );
                })}

                {phase === 'done' ? (
                  <Animated.View
                    entering={FadeInDown.duration(STEP_ADVANCE_MS).delay(
                      COMPLETION_DELAY_MS,
                    )}>
                    <CompletionRow onDone={onDone} testID="onboard-complete" />
                  </Animated.View>
                ) : null}
              </View>

              {/*
               * One control, switched on the sub-stage. Hidden once the form is
               * finished, per the source's `if !hasFinishedForm`: the completion
               * row should be the only thing left on screen.
               */}
              {phase !== 'done' && !authDone && identify === 'choose' ? (
                <Animated.View
                  entering={FadeInDown.duration(STEP_ADVANCE_MS)}
                  exiting={FadeOutUp.duration(STEP_EXIT_MS)}
                  style={styles.choices}>
                  {/*
                   * PRIMARY: white-pill Google button.
                   *
                   * White fill on the dark bloom keeps contrast without borrowing
                   * the brand coral. The Google "G" sits directly on white (its
                   * own brand rule: the mark must sit on a light surface), so the
                   * chip wrapper is gone. A 1px rgba hairline gives definition
                   * against a lighter bloom without reading as a border.
                   */}
                  <Pressable
                    onPress={onGoogle}
                    testID="onboard-google"
                    accessibilityLabel="Continue with Google"
                    press="button"
                    style={styles.primary}
                  >
                    {state === 'loading' ? (
                      <LoadingIndicator size={20} containerColor="transparent" />
                    ) : (
                      <>
                        <Image
                          source={require('../../assets/brands/google.png')}
                          style={styles.googleMark}
                          resizeMode="contain"
                          accessibilityIgnoresInvertColors
                        />
                        <Text allowFontScaling style={styles.primaryLabel}>
                          Continue with Google
                        </Text>
                      </>
                    )}
                  </Pressable>

                  {/*
                   * SECONDARY: glass-pill phone link.
                   *
                   * Translucent white fill rather than a bare text link, so the
                   * two-pill stack reads as a real choice pair. Same approach
                   * as CallScreen's non-primary buttons.
                   */}
                  {PHONE_AUTH_ENABLED ? (
                    <Pressable
                      onPress={onUsePhone}
                      testID="onboard-use-phone"
                      accessibilityLabel="Use my number instead"
                      press="button"
                      style={styles.secondary}
                    >
                      <Text allowFontScaling style={styles.secondaryLabel}>
                        Use my number instead
                      </Text>
                    </Pressable>
                  ) : null}

                  {/* Ghost link — small, centered, 44pt hit target. */}
                  <Pressable
                    onPress={onBecomePartner}
                    testID="onboard-become-partner"
                    accessibilityLabel="Apply to become a partner"
                    press="button"
                    style={styles.partnerLink}
                  >
                    <Text allowFontScaling style={styles.partnerLinkLabel}>
                      Become a partner
                    </Text>
                  </Pressable>
                </Animated.View>
              ) : null}

              {phase !== 'done' && !authDone && identify === 'number' ? (
                <Animated.View
                  entering={FadeInDown.duration(STEP_ADVANCE_MS)}
                  exiting={FadeOutUp.duration(STEP_EXIT_MS)}
                  style={styles.numberBlock}>
                  <View style={styles.field}>
                    {/* Country-code selector leading the national number field. */}
                    <CountryPicker
                      value={dialCode}
                      onChange={setDialCode}
                      testID="onboard-country"
                    />
                    <TextField
                      value={phone}
                      onChangeText={setPhone}
                      editable={state !== 'loading'}
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                      autoComplete="tel"
                      // Android autofill hint, matching the code field. Without
                      // it the framework skips the field on API 26+, so a saved
                      // number is never offered (Twilio/RN autofill guidance).
                      importantForAutofill="yes"
                      autoFocus
                      placeholder="Your number"
                      placeholderTextColor={theme.color.text.tertiary}
                      style={styles.input}
                      testID="onboard-phone"
                      onSubmitEditing={onSendCode}
                    />
                    {/*
                     * The submit mark is `chevron-right`, not `reply`. The source
                     * uses `arrow.right`; `reply` in this set is the arrow head
                     * rotated to point LEFT over a return stroke, so it reads as
                     * going back on a button whose only job is going forward.
                     */}
                    {/*
                      * Dimmed until the field holds something plausible, per the
                      * source's `.background(.black.opacity(isValid ? 1 : 0.2))`.
                      * A submit that looks identical whether or not it will do
                      * anything is a control that lies about its own state.
                      */}
                    <Pressable
                      onPress={onSendCode}
                      disabled={state === 'loading'}
                      testID="onboard-send-code"
                      accessibilityLabel="Send code"
                      press="button"
                      style={[styles.go, canSend ? null : styles.goIdle]}
                    >
                      {state === 'loading' ? (
                        <LoadingIndicator size={20} color={theme.color.text.onAccent} containerColor="transparent" />
                      ) : (
                        <Icon
                          name="chevronRight"
                          size={20}
                          color={theme.color.text.onAccent}
                        />
                      )}
                    </Pressable>
                  </View>
                  <Text allowFontScaling style={styles.numberHint}>
                    We'll send an SMS to verify your number.
                  </Text>
                </Animated.View>
              ) : null}

              {phase !== 'done' && authDone ? (
                /*
                 * M3 filter-chip row: four bands, tonal fill on selection,
                 * then a Continue pill.
                 *
                 * No "Under 18" chip: the product is adults only. Showing a
                 * band we would not serve would be a lie. Soft self-declaration
                 * means no DOB picker — the chip row is the whole UI.
                 *
                 * Tapping a chip both selects it and auto-submits. One action
                 * is faster than two, and the Continue button on a declaration
                 * (not a text input) has no incremental value. The button is
                 * kept as an accessible fallback and for the loading/error state.
                 */
                <Animated.View
                  entering={FadeInDown.duration(STEP_ADVANCE_MS)}
                  exiting={FadeOutUp.duration(STEP_EXIT_MS)}
                  style={styles.ageBlock}>
                  <View style={styles.ageChips}>
                    {AGE_BRACKETS.map(bracket => {
                      const selected = selectedBracket === bracket;
                      return (
                        <Pressable
                          key={bracket}
                          onPress={() => {
                            setSelectedBracket(bracket);
                            // Auto-advance: selection IS the confirmation.
                            // The explicit submit fires from onSubmitAge but we
                            // trigger it here immediately so one tap does the job.
                            if (canSubmit(state)) {
                              setState('loading');
                              setFailure(null);
                              void setMemberAgeBracket(bracket)
                                .then(() => {
                                  setState('success');
                                  finish();
                                })
                                .catch(err => {
                                  setSelectedBracket(null);
                                  fail(
                                    err instanceof Error
                                      ? err.message
                                      : 'Could not save age. Please try again.',
                                  );
                                });
                            }
                          }}
                          disabled={state === 'loading'}
                          testID={`age-chip-${bracket}`}
                          accessibilityRole="radio"
                          checked={selected}
                          accessibilityLabel={bracket}
                          press="none"
                          style={[
                            styles.ageChip,
                            selected && styles.ageChipSelected,
                          ]}>
                          <Text
                            allowFontScaling
                            style={[
                              styles.ageChipLabel,
                              selected && styles.ageChipLabelSelected,
                            ]}>
                            {bracket}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {/*
                   * Continue button: shown as a spinner while the RPC runs, as
                   * a dead chip if nothing is selected yet. Primary affordance
                   * is the chip tap itself; this is the reachable target for
                   * someone who noticed they tapped wrong and wants to swap.
                   */}
                  <Pressable
                    onPress={onSubmitAge}
                    disabled={selectedBracket === null || state === 'loading'}
                    testID="age-continue"
                    accessibilityLabel="Continue"
                    press="button"
                    style={[
                      styles.primary,
                      (selectedBracket === null || state === 'loading')
                        ? styles.ageContinueIdle
                        : null,
                    ]}>
                    {state === 'loading' ? (
                      <LoadingIndicator size={20} containerColor="transparent" />
                    ) : (
                      <Text allowFontScaling style={styles.primaryLabel}>
                        Continue
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              ) : null}

              {phase !== 'done' && !authDone && identify === 'code' ? (
                <Animated.View
                  entering={FadeInDown.duration(STEP_ADVANCE_MS)}
                  exiting={FadeOutUp.duration(STEP_EXIT_MS)}
                  style={styles.codeBlock}>
                  <CodeField
                    value={code}
                    onChange={setCode}
                    onComplete={onVerify}
                    verifying={state === 'loading'}
                    succeeded={state === 'success'}
                    errorNonce={errorNonce}
                    testID="onboard-code"
                  />
                  {resent ? (
                    <Text
                      allowFontScaling
                      accessibilityLiveRegion="polite"
                      style={styles.resentNote}>
                      New code sent — the previous one no longer works.
                    </Text>
                  ) : null}
                  <View style={styles.codeActions}>
                    <Pressable
                      onPress={onChangeNumber}
                      testID="onboard-change-number"
                      accessibilityLabel="Change phone number"
                      press="button"
                      style={styles.resendLink}>
                      <Text allowFontScaling style={styles.resendLabel}>
                        Change number
                      </Text>
                    </Pressable>
                    {/* Resend affordance with cooldown, mirroring AuthScreen. */}
                    <Pressable
                      onPress={onResend}
                      disabled={cooldown > 0 || state === 'loading'}
                      testID="onboard-resend"
                      accessibilityLabel={
                        cooldown > 0
                          ? `Resend code in ${cooldown} seconds`
                          : 'Resend code'
                      }
                      press="button"
                      style={styles.resendLink}>
                      <Text
                        allowFontScaling
                        style={[
                          styles.resendLabel,
                          cooldown > 0 || state === 'loading'
                            ? styles.resendLabelDimmed
                            : null,
                        ]}>
                        {cooldown > 0
                          ? `Resend in ${cooldown}s`
                          : 'Resend code'}
                      </Text>
                    </Pressable>
                  </View>
                </Animated.View>
              ) : null}

              {failure !== null ? (
                <Animated.Text
                  entering={FadeIn.duration(STEP_ADVANCE_MS)}
                  allowFontScaling
                  accessibilityLiveRegion="polite"
                  style={styles.failure}
                >
                  {failure}
                </Animated.Text>
              ) : null}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    /*
     * `flexShrink` so a short window takes height from the carousel rather than
     * from the CTA. The carousel is atmosphere; the button is the only thing on
     * this screen a person needs to reach.
     */
    welcome: {
      flex: 1,
      justifyContent: 'space-between',
    },
    column: {
      marginHorizontal: COLUMN_INSET,
      flexShrink: 1,
      overflow: 'hidden',
    },
    // No `flexShrink`: the CTA block keeps its full height at every size and the
    // carousel above it gives way instead.
    block: {
      paddingHorizontal: BLOCK_PAD,
      gap: SOURCE_METRICS.welcomeGap,
    },
    // The brand mark at Fuse's exact `frame(width: 50)` (WelcomeScreen.swift:37).
    // Square source (the mark centred in a transparent square), so 50×50 lands the
    // glyph at 50 wide like the reference.
    // A soft elevation under the tile so it floats above the bloom — the "3D a
    // bit" read. `alignSelf: 'flex-start'` keeps the shadow box to the tile's 50,
    // not the block's full width. The dark background matches the tile so the
    // Android elevation outline never shows a seam.
    markShadow: {
      alignSelf: 'flex-start',
      borderRadius: 12,
      borderCurve: 'continuous',
      backgroundColor: '#141416',
      elevation: 10,
      shadowColor: '#000000',
      shadowOpacity: 0.32,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
    },
    // Fuse's logo is `frame(width: 50)`; the sheen (light top → dark bottom) is
    // baked into the asset to match the dimensional look of its carousel glyphs.
    mark: {
      width: 50,
      height: 50,
      borderRadius: 12,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    // The brand wordmark: white on the dark bloom field so it reads at display
    // size, with full contrast against the dark welcome bloom.
    brand: {
      ...TOKENS.typography.wordmark,
      fontSize: 34,
      lineHeight: 38,
      color: t.color.text.onAccent,
    },
    // The website line ("Positive conversations, made simple."), white on the
    // field at 0.7 like Fuse's description (WelcomeScreen.swift:44). Legal because
    // the block is pinned to the bottom where the field is dark.
    subtitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.onAccent,
      opacity: 0.7,
    },
    cta: {
      height: SOURCE_METRICS.buttonHeight,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.base,
    },
    ctaLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    /*
     * The form sits at the BOTTOM while there are questions left and moves to the
     * CENTRE once there are not, which is the source's
     * `alignment: hasFinishedForm ? .center : .bottomLeading`. Worth keeping: the
     * bottom is where a thumb is, and the centre is where a result belongs.
     */
    // The host is what covers the screen; the form inside it is what flexes, so
    // `KeyboardAvoidingView` has something to resize.
    formHost: {
      ...StyleSheet.absoluteFill,
    },
    scroll: {
      flex: 1,
    },
    // `flexGrow`, not `flex`: the content must be free to exceed the viewport in
    // a short window while still filling a tall one. Plain `flex: 1` collapses
    // the block to its content height in portrait and floats it at the top,
    // which is the usual way this fix breaks the common case.
    scrollContent: {
      flexGrow: 1,
    },
    /*
     * NO `flex: 1`, and that is the fix rather than an omission.
     *
     * With a fixed viewport height and `justifyContent: 'flex-end'`, content
     * taller than the box does not scroll — it overflows off the TOP and is
     * clipped, which in landscape put the step title behind the status bar.
     * Height and alignment belong to the ScrollView's content container, where
     * `flexGrow: 1` lets the box grow past the viewport instead.
     */
    form: {
      paddingHorizontal: BLOCK_PAD,
      // The source's outer `VStack(spacing: 64)`. There is no 64 on the space
      // scale and there should not be one: this is a measured value for this
      // layout, and rounding it to `space.3xl` (40) closes a gap the reference
      // deliberately leaves open between the checklist and the control.
      gap: SOURCE_METRICS.formGap,
    },
    // The inner `VStack(alignment: .leading, spacing: 32)`.
    checklist: {
      gap: SOURCE_METRICS.stepGap,
    },
    formBottom: {
      justifyContent: 'flex-end',
    },
    formCentred: {
      justifyContent: 'center',
    },
    choices: {
      gap: TOKENS.space.sm,
    },
    // PRIMARY: white pill. Label is ink, loading spinner is ink.
    // 1px rgba hairline gives shape definition against the dark bloom.
    primary: {
      flexDirection: 'row',
      gap: TOKENS.space.xs,
      minHeight: SOURCE_METRICS.buttonHeight,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.08)',
    },
    primaryLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    googleMark: {
      width: 20,
      height: 20,
    },
    // SECONDARY: outline pill. The sign-in ("choose") surface is a LIGHT warm
    // field, so a translucent-white glass fill would vanish. A transparent pill
    // with a hairline border + ink label reads on light and adapts in dark mode,
    // and pairs cleanly with the solid-white primary above it.
    secondary: {
      height: SOURCE_METRICS.buttonHeight,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.color.border.strong,
    },
    secondaryLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    // Ghost / tertiary text link — small, centered, 44pt hit target. Uses the
    // muted secondary ink so it reads on the light sign-in field.
    partnerLink: {
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    partnerLinkLabel: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    // Number entry: picker + field + send button in a row.
    numberBlock: {
      gap: TOKENS.space.xs,
    },
    /*
     * M3 text field, a stated departure from Fuse's pill (Amit, 2026-09-03:
     * "input field should be m3", "wider to not cut off numbers").
     *
     * Fuse's `InputField` is a capsule (`cornerRadius: .infinity`) holding a
     * bare email field — the WHOLE width is the number, so a pill works there.
     * Ours prefixes a CountryPicker and suffixes an inline send, which on a
     * 42pt-inset form (`blockPad`, Fuse-faithful) left too little for a ten-digit
     * Indian number. Two changes reclaim it and modernise the look:
     *   - `radius.field` (10) instead of `radius.pill` — this is the app's own
     *     M3 field/filled-button radius (see tokens `radius.$note`), so the field
     *     reads as a Material field rather than an iOS capsule.
     *   - leading 16 (M3 text-field padding) and a tighter trailing/gap, since
     *     the send is a self-padded disc — freeing ~24dp for the number.
     * developer.android.com/develop/ui/views/components/text-fields and M3
     * text-field specs: container height 56, 16dp content padding.
     */
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingLeft: TOKENS.space.md,
      paddingRight: TOKENS.space.xs,
      height: 56,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.base,
    },
    numberHint: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.xs,
    },
    // 20pt, from `.font(.system(size: 20, weight: .medium))`. The headline token
    // is 17 and reads small next to a 42pt step title.
    input: {
      flex: 1,
      ...TOKENS.typography.headline,
      fontSize: SOURCE_METRICS.inputText,
      lineHeight: SOURCE_METRICS.inputText * 1.3,
      color: t.color.text.primary,
    },
    // 44, not the source's ~40. See SOURCE_METRICS.submitTarget.
    // The source's `.opacity(0.2)` on the disabled fill, expressed as a fill
    // rather than a view opacity so the glyph inside stays fully opaque.
    goIdle: {
      backgroundColor: t.color.bg.hover,
    },
    go: {
      width: SOURCE_METRICS.submitTarget,
      height: SOURCE_METRICS.submitTarget,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      // Near-black, matching Fuse's primary action (its "Create … Key" pill is
      // black). Coral is reserved for the active step's icon, not the submit.
      backgroundColor: t.color.text.primary,
    },
    // Age bracket picker: chip row + continue button.
    ageBlock: {
      gap: TOKENS.space.sm,
    },
    ageChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
    },
    /*
     * M3 filter chip: outlined at rest, tonal fill on selection.
     *
     * On the dark welcome bloom `t.color.bg.base` is dark, so the resting chip
     * reads as a translucent outline on a dark surface — correct. Selected gets
     * a white fill (tonal on a dark bloom = high-contrast white), matching the
     * Google primary button directly above. The hairline border keeps definition
     * against the bloom at any brightness level.
     */
    ageChip: {
      paddingVertical: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: TOKENS.interaction.minTarget,
    },
    ageChipSelected: {
      backgroundColor: '#FFFFFF',
      borderColor: '#FFFFFF',
    },
    ageChipLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    ageChipLabelSelected: {
      // The selected surface is deliberately white in both theme modes.
      // Use the paired light-surface ink rather than theme.primary, which turns
      // white in dark mode and made the selected label disappear.
      color: LIGHT.color.text.primary,
    },
    // The continue button dims when no bracket is selected.
    ageContinueIdle: {
      opacity: 0.4,
    },
    // Code entry + resend affordance.
    codeBlock: {
      gap: TOKENS.space.sm,
    },
    codeActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: TOKENS.space.lg,
    },
    // The "previous code no longer works" note, centred under the boxes. Muted
    // secondary ink — informational, not an error.
    resentNote: {
      ...TOKENS.typography.captionRegular,
      color: t.color.text.secondary,
      textAlign: 'center',
      paddingHorizontal: TOKENS.space.xs,
    },
    resendLink: {
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    resendLabel: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    resendLabelDimmed: {
      opacity: 0.4,
    },
    // `HStack(alignment: .top, spacing: 24)` and `VStack(spacing: 12)`.
    doneRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: SOURCE_METRICS.doneGap,
    },
    doneBody: {
      flex: 1,
      gap: SOURCE_METRICS.doneBodyGap,
    },
    // 24pt, from `.font(.system(size: 24)).bold()`. The completion title is
    // deliberately SMALLER than a step title: the flow is over, and shouting the
    // result would make it the loudest thing on a screen that is now calm.
    doneTitle: {
      ...TOKENS.typography.displayLarge,
      fontSize: SOURCE_METRICS.doneTitle,
      lineHeight: Math.round(SOURCE_METRICS.doneTitle * 1.2),
      color: t.color.text.primary,
    },
    doneText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    failure: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.state.danger,
    },
  });
