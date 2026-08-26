import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
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
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { BLOOM_CONTENT_MS, BLOOM_FIELD_MS, BLOOM_HOLD_MS } from '../lib/bloom';
import {
  COMPLETION_DELAY_MS,
  SOURCE_METRICS,
  STEP_ADVANCE_MS,
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
import { Pressable } from '../components/Pressable';
import { CodeField } from '../components/CodeField';
import { Spinner } from '../components/Spinner';
import { Icon } from '../components/Icon';
import { CompletionRow } from '../components/CompletionRow';
import { TextField } from '../components/TextField';
import {
  GoogleCredentialError,
  PHONE_AUTH_ENABLED,
  sendPhoneOtp,
  signInWithGoogle,
  verifyPhoneOtp,
} from '../api/auth';

const BLOCK_PAD = SOURCE_METRICS.blockPad;
const COLUMN_TOP = SOURCE_METRICS.columnTop;
const COLUMN_INSET = SOURCE_METRICS.columnInset;

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

  const [phase, setPhase] = useState<Phase>('welcome');
  const [route, setRoute] = useState<Route>('undecided');
  const [identify, setIdentify] = useState<IdentifyStage>('choose');
  const [state, setState] = useState<FieldState>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [errorNonce, setErrorNonce] = useState(0);

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

  /*
   * The field's clock, in milliseconds, driven LINEARLY.
   *
   * The easing lives per layer in `layerProgress`, not here, because each layer
   * runs its own 500ms curve from its own start time. Easing this value would
   * apply one curve across all three and destroy the stagger that is the effect.
   */
  const elapsed = useSharedValue(0);
  const welcomeOut = useSharedValue(0);

  const steps = useMemo(() => visibleSteps(route), [route]);
  const activeKey = identify === 'code' ? 'verify' : 'identify';
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
    // from the end of the content transition.
    after(BLOOM_HOLD_MS, () => setPhase('form'));
  }, [phase, elapsed, welcomeOut, after]);

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
        setState('success');
        finish();
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
  }, [state, finish, fail]);

  const onUsePhone = useCallback(() => {
    setRoute('phone');
    setIdentify('number');
    setState('idle');
    setFailure(null);
  }, []);

  /*
   * The source's `isValid`, which is `!value.isEmpty`. Ours asks for a little
   * more because an Indian mobile number is ten digits and a one-character
   * "valid" would enable a submit that the server is certain to reject.
   */
  const canSend = phone.trim().length >= 6 && state !== 'loading';

  const onSendCode = useCallback(() => {
    if (!canSubmit(state) || phone.trim().length < 6) {
      return;
    }
    setState('loading');
    setFailure(null);
    /*
     * The source's `keyboardShown = false` inside `submitCurrentStep`. Without
     * it the keyboard stays up over the result of the thing just submitted,
     * which on a short window is most of the screen.
     */
    Keyboard.dismiss();
    void (async () => {
      const result = await sendPhoneOtp(phone);
      if (result.status !== 'failed') {
        setState('idle');
        setIdentify('code');
        return;
      }
      fail(result.message);
    })();
  }, [state, phone, fail]);

  const onVerify = useCallback(
    (entered: string) => {
      if (!canSubmit(state)) {
        return;
      }
      setState('loading');
      setFailure(null);
      void (async () => {
        const result = await verifyPhoneOtp(phone, entered);
        if (result.status !== 'failed') {
          setState('success');
          finish();
          return;
        }
        fail(result.message);
        setCode('');
      })();
    },
    [state, phone, finish, fail],
  );

  /*
   * `.transition(.opacity.combined(with: .offset(y: 20)))` from the source: the
   * welcome content does not just fade, it settles 20pt downward as it goes.
   */
  const welcomeStyle = useAnimatedStyle(() => ({
    opacity: 1 - welcomeOut.value,
    transform: [{ translateY: welcomeOut.value * 20 }],
  }));

  const showWelcome = phase === 'welcome' || phase === 'leaving';
  const showForm = phase === 'form' || phase === 'done';

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
            <WordColumn words={words} testID="welcome-words" />
          </Animated.View>

          <Animated.View
            style={[
              styles.block,
              { paddingBottom: BLOCK_PAD + insets.bottom },
              welcomeStyle,
            ]}
          >
            <View style={styles.mark}>
              <Text allowFontScaling={false} style={styles.markLetter}>
                p
              </Text>
            </View>
            <Text allowFontScaling style={styles.title}>
              Someone to talk to,{'\n'}tonight.
            </Text>
            <Text allowFontScaling style={styles.subtitle}>
              Real people, by the minute.{'\n'}Not therapy, just company.
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
              entering={FadeInDown.duration(BLOOM_CONTENT_MS)}
              style={[
                styles.form,
                phase === 'done' ? styles.formCentred : styles.formBottom,
                {
                  paddingBottom: BLOCK_PAD + (keyboardUp ? 0 : insets.bottom),
                  paddingTop: BLOCK_PAD + insets.top,
                },
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
                {steps.map(spec => (
                  <OnboardingStep
                    key={spec.key}
                    step={spec}
                    expanded={phase !== 'done' && spec.key === activeKey}
                    testID={`step-${spec.key}`}
                  />
                ))}

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
              {phase !== 'done' && identify === 'choose' ? (
                <View style={styles.choices}>
                  <Pressable
                    onPress={onGoogle}
                    testID="onboard-google"
                    accessibilityLabel="Continue with Google"
                    press="button"
                    style={styles.primary}
                  >
                    {state === 'loading' ? (
                      <Spinner size={20} color={theme.color.text.onAccent} />
                    ) : (
                      <>
                        {/*
                         * The source's `ContinueButton` is a mark then a label —
                         * `Image(systemName: icon)` before `Text(title)` — so the
                         * button restates what it is about to do rather than
                         * relying on the step title above it. Ours was the label
                         * alone.
                         */}
                        <Icon
                          name="chat"
                          size={20}
                          color={theme.color.text.onAccent}
                        />
                        <Text allowFontScaling style={styles.primaryLabel}>
                          Continue with Google
                        </Text>
                      </>
                    )}
                  </Pressable>
                  {PHONE_AUTH_ENABLED ? (
                    <Pressable
                      onPress={onUsePhone}
                      testID="onboard-use-phone"
                      accessibilityLabel="Use my number instead"
                      press="row"
                      style={styles.alt}
                    >
                      <Text allowFontScaling style={styles.altLabel}>
                        Use my number instead
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {phase !== 'done' && identify === 'number' ? (
                <View style={styles.field}>
                  <TextField
                    value={phone}
                    onChangeText={setPhone}
                    editable={state !== 'loading'}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
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
                    testID="onboard-send-code"
                    accessibilityLabel="Send code"
                    press="button"
                    style={[styles.go, canSend ? null : styles.goIdle]}
                  >
                    {state === 'loading' ? (
                      <Spinner size={18} color={theme.color.text.onAccent} />
                    ) : (
                      <Icon
                        name="chevronRight"
                        size={20}
                        color={theme.color.text.onAccent}
                      />
                    )}
                  </Pressable>
                </View>
              ) : null}

              {phase !== 'done' && identify === 'code' ? (
                <CodeField
                  value={code}
                  onChange={setCode}
                  onComplete={onVerify}
                  editable={state !== 'loading'}
                  errorNonce={errorNonce}
                  testID="onboard-code"
                />
              ) : null}

              {failure !== null ? (
                <Animated.Text
                  entering={FadeIn.duration(STEP_ADVANCE_MS)}
                  allowFontScaling
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
    mark: {
      width: SOURCE_METRICS.logo,
      height: SOURCE_METRICS.logo,
      borderRadius: 14,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.base,
    },
    markLetter: {
      ...TOKENS.typography.wordmark,
      fontSize: 30,
      lineHeight: 34,
      color: t.color.bg.accent,
    },
    // White on the field, which is only legal because the block is pinned to the
    // bottom where the field is dark.
    title: {
      ...TOKENS.typography.displayLarge,
      color: t.color.text.onAccent,
    },
    subtitle: {
      ...TOKENS.typography.bodyMedium,
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
    primary: {
      flexDirection: 'row',
      // The source's `HStack` default spacing between the mark and the label.
      gap: TOKENS.space.xs,
      height: SOURCE_METRICS.buttonHeight,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.text.primary,
    },
    primaryLabel: {
      ...TOKENS.typography.headline,
      color: t.color.text.onAccent,
    },
    alt: {
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    altLabel: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      // `.padding(.leading, 24)` / `.padding(.trailing, 16)` from InputField.
      paddingLeft: SOURCE_METRICS.inputLeading,
      paddingRight: SOURCE_METRICS.inputTrailing,
      height: 56,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
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
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.text.primary,
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
