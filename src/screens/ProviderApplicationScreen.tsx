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
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  BLOOM_CONTENT_MS,
  BLOOM_FIELD_MS,
  BLOOM_HOLD_MS,
} from '../lib/bloom';
import {
  COMPLETION_DELAY_MS,
  SOURCE_METRICS,
  STEP_ADVANCE_MS,
  coresCollapsed,
  type Phase,
  type StepSpec,
} from '../lib/onboarding';
import { BloomField } from '../components/BloomField';
import { OnboardingStep } from '../components/OnboardingStep';
import { CompletionRow } from '../components/CompletionRow';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TextField } from '../components/TextField';
import type { Gender } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { useMyApplication, useSubmitApplication } from '../api/provider';
import { ageFromIso, dobToIso, formatDobInput } from '../lib/dob';
import {
  APPLICATION_STEPS,
  firstFlaggedStep,
  missingOnStep,
} from '../lib/applicationSteps';
import {
  PROVIDER_STEPS,
  providerPaletteFor,
  type ProviderStepKey,
} from '../lib/providerOnboarding';

const BLOCK_PAD = SOURCE_METRICS.blockPad;

interface Props {
  onBack: () => void;
  onSubmitted: () => void;
}

const GENDERS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi'];

/** Server-side field names → what a person should read. */
const FIELD_LABEL: Record<string, string> = {
  display_name: 'Name',
  gender: 'Gender',
  date_of_birth: 'Date of Birth',
  headline: 'Headline',
  languages: 'Languages',
  about: 'About',
};

/**
 * Applying to be a provider, in three steps, on the Fuse bloom layout.
 *
 * The age gate is here *and* in SQL, on purpose. The constraint in migration 006
 * is what makes an underage provider unrepresentable; this check exists so a
 * 17-year-old is told immediately rather than filling in six fields and being
 * refused at the end.
 *
 * The submit path is unchanged: `useSubmitApplication` sends all six fields at
 * once and is still the authority on what is missing. `missing_fields` comes back
 * from the server and marks the inputs; a resubmit opens on the step holding the
 * first flagged field. See `src/lib/applicationSteps.ts`.
 *
 * The bloom field mounts once and lives through all phases, exactly as in
 * `OnboardingScreen`. A welcome beat (with a back escape) transitions into the
 * stepped form, then into the completion row.
 */
export function ProviderApplicationScreen({ onBack, onSubmitted }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: existing } = useMyApplication();
  const submit = useSubmitApplication();

  const [phase, setPhase] = useState<Phase>('welcome');
  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  // Held as the DD/MM/YYYY the applicant typed; converted once, on submit.
  const [dob, setDob] = useState('');
  const dobIso = dobToIso(dob);
  const [headline, setHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>(existing?.missing_fields ?? []);
  const [step, setStep] = useState(0);
  const last = APPLICATION_STEPS.length - 1;

  const underage = useMemo(() => {
    const age = dobIso === null ? null : ageFromIso(dobIso);
    return age !== null && age < 18;
  }, [dobIso]);
  // Only once the field is full. Complaining at four digits is complaining about
  // a date that is still being typed.
  const dobUnusable = dob.length === 10 && dobIso === null;

  /*
   * The IME is part of the layout. See the same block in OnboardingScreen for
   * the full reasoning; the short version is that RN 0.86 runs edge-to-edge and
   * a form absolutely positioned on top of the field sits under the keyboard
   * with nothing to push it up unless we track the keyboard state explicitly.
   */
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /*
   * The field's clock and the welcome content's exit value.
   * Both are driven linearly from `begin()` and live through all phases.
   */
  const elapsed = useSharedValue(0);
  const welcomeOut = useSharedValue(0);
  // The form's arrival, driven at the handoff (see OnboardingScreen's `formIn`).
  const formIn = useSharedValue(0);

  const activeKey: ProviderStepKey = PROVIDER_STEPS[step]?.key ?? 'you';

  const stage = useMemo(
    () => ({
      palette: providerPaletteFor(phase, step),
      collapsed: coresCollapsed(phase),
    }),
    [phase, step],
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

  /** Continue from welcome: content leaves, field turns over, then the form. */
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
    after(BLOOM_HOLD_MS, () => {
      setPhase('form');
      formIn.value = withTiming(1, {
        duration: STEP_ADVANCE_MS,
        easing: Easing.inOut(Easing.quad),
      });
    });
  }, [phase, elapsed, welcomeOut, formIn, after]);

  const toggleLanguage = useCallback((language: string) => {
    setLanguages(prev =>
      prev.includes(language) ? prev.filter(l => l !== language) : [...prev, language],
    );
  }, []);

  const send = useCallback(() => {
    submit.mutate(
      {
        displayName,
        gender,
        dateOfBirth: dobIso,
        headline,
        languages,
        about,
      },
      {
        onSuccess: fields => {
          setMissing(fields);
          if (fields.length === 0) {
            track('application_submitted');
            setPhase('done');
            return;
          }
          // Land on the gap rather than at the top. Without this the steps would
          // make the existing "we will name what is missing" promise WORSE than
          // the single scroll it replaced: named, and then two taps away.
          setStep(firstFlaggedStep(fields));
        },
      },
    );
  }, [submit, displayName, gender, dobIso, headline, languages, about]);

  const flag = (field: string): boolean => missing.includes(field);
  // Only this step's gaps. The full list is on ProviderStatusScreen; repeating it
  // on every step would be six bullets above three fields.
  const gaps = missingOnStep(missing, step);

  /*
   * `.transition(.opacity.combined(with: .offset(y: 20)))` from the source:
   * the welcome content does not just fade, it settles 20pt downward as it goes.
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
  // Mounted at the press, shown at the handoff — see OnboardingScreen's
  // `showForm` for why the heavy commit must not land on the field's last frames.
  const showForm = phase !== 'welcome';
  const formReady = phase === 'form' || phase === 'done';

  return (
    <View style={styles.root}>
      <BloomField elapsed={elapsed} stage={stage} hidden={keyboardUp} />

      {showWelcome ? (
        /*
         * A flex column, not two absolute boxes — same fix as OnboardingScreen.
         * The head (back button) sits at the top and the block (title + CTA)
         * anchors to the bottom, dividing whatever height exists between them.
         */
        <View style={styles.welcome} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.welcomeHead,
              { paddingTop: insets.top + TOKENS.space.xs },
              welcomeStyle,
            ]}>
            <Pressable
              onPress={onBack}
              testID="application-back"
              accessibilityLabel="Back"
              press="none"
              highlight="ios"
              style={styles.back}>
              <Icon name="chevronLeft" size={22} />
            </Pressable>
          </Animated.View>

          <Animated.View
            style={[
              styles.block,
              { paddingBottom: BLOCK_PAD + insets.bottom },
              welcomeStyle,
            ]}>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.wordmarkLarge} allowFontScaling style={styles.welcomeTitle}>
              Become a Provider
            </Text>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineMediumEmphasized} allowFontScaling style={styles.welcomeBody}>
              Share your time.{'\n'}Change someone's night.
            </Text>
            <Text allowFontScaling style={styles.welcomeSub}>
              Real conversations, by the minute.
            </Text>
            {/*
             * No `busy` prop, deliberately. The transition IS the narration: the
             * whole surface fades and the field turns over the instant this is
             * pressed, and double-fire is prevented by the guard in `begin`.
             */}
            <Pressable
              onPress={begin}
              testID="application-continue"
              accessibilityLabel="Continue"
              press="button"
              style={styles.cta}>
              <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.ctaLabel}>
                Continue
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      ) : null}

      {showForm ? (
        <KeyboardAvoidingView
          style={styles.formHost}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents={formReady ? 'auto' : 'none'}
          importantForAccessibility={formReady ? 'auto' : 'no-hide-descendants'}>
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
            bounces={false}>
            <Animated.View
              style={[
                styles.form,
                phase === 'done' ? styles.formCentred : styles.formBottom,
                formStyle,
                {
                  paddingBottom: BLOCK_PAD + (keyboardUp ? 0 : insets.bottom),
                  paddingTop: BLOCK_PAD + insets.top,
                },
              ]}>
              {/*
               * The checklist, and then the form fields BELOW it — the source's
               * structure. The checklist always shows all three rows; the active
               * step expands while the others collapse to a small icon + title.
               * That is what makes the flow read as progress through one thing
               * rather than as three separate screens.
               */}
              <View style={styles.checklist}>
                {PROVIDER_STEPS.map(spec => (
                  <OnboardingStep
                    key={spec.key}
                    step={spec as unknown as StepSpec}
                    expanded={spec.key === activeKey && phase !== 'done'}
                    testID={`step-${spec.key}`}
                  />
                ))}

                {phase === 'done' ? (
                  <Animated.View
                    entering={FadeInDown.duration(STEP_ADVANCE_MS).delay(
                      COMPLETION_DELAY_MS,
                    )}>
                    <CompletionRow
                      onDone={onSubmitted}
                      testID="application-complete"
                    />
                  </Animated.View>
                ) : null}
              </View>

              {phase !== 'done' ? (
                <>
                  {gaps.length > 0 ? (
                    <View testID="application-missing" style={styles.missingBox}>
                      <Text allowFontScaling style={styles.missingTitle}>
                        Still Needed
                      </Text>
                      {gaps.map(f => (
                        <Text key={f} allowFontScaling style={styles.missingItem}>
                          • {FIELD_LABEL[f] ?? f}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {step === 0 ? (
                    <>
                      <Field label="Name" flagged={flag('display_name')}>
                        <TextField
                          testID="app-name"
                          style={styles.input}
                          value={displayName}
                          onChangeText={setDisplayName}
                          placeholder="What should people call you?"
                          placeholderTextColor={theme.color.text.tertiary}
                          maxLength={40}
                          allowFontScaling
                          underlineColorAndroid="transparent"
                        />
                      </Field>

                      <Field label="Gender" flagged={flag('gender')}>
                        <View style={styles.chips}>
                          {GENDERS.map(g => (
                            <Chip
                              key={g.value}
                              label={g.label}
                              tone={gender === g.value ? 'warm' : 'neutral'}
                              onPress={() => setGender(g.value)}
                            />
                          ))}
                        </View>
                      </Field>

                      {/*
                       * The age gate. Accepts DD/MM/YYYY, the en-IN order,
                       * auto-formatted from a number pad, and converts on submit.
                       * It is in the FIRST step so the refusal arrives after three
                       * fields instead of after a life story.
                       */}
                      <Field label="Date of Birth" flagged={flag('date_of_birth')}>
                        <TextField
                          testID="app-dob"
                          style={styles.input}
                          value={dob}
                          onChangeText={next => setDob(formatDobInput(next))}
                          placeholder="DD/MM/YYYY"
                          placeholderTextColor={theme.color.text.tertiary}
                          keyboardType="number-pad"
                          maxLength={10}
                          allowFontScaling
                          underlineColorAndroid="transparent"
                        />
                        {dobUnusable ? (
                          <Text allowFontScaling style={styles.hint}>
                            That is not a date. For example 23/04/1998.
                          </Text>
                        ) : null}
                        {underage ? (
                          <Text
                            testID="app-underage"
                            allowFontScaling
                            style={styles.underageText}>
                            Providers must be 18 or older. We cannot accept this application.
                          </Text>
                        ) : null}
                      </Field>
                    </>
                  ) : null}

                  {step === 1 ? (
                    <>
                      <Field label="Languages" flagged={flag('languages')}>
                        <View style={styles.chips}>
                          {LANGUAGES.map(l => (
                            <Chip
                              key={l}
                              label={l}
                              tone={languages.includes(l) ? 'warm' : 'neutral'}
                              onPress={() => toggleLanguage(l)}
                            />
                          ))}
                        </View>
                      </Field>

                      <Field label="Headline" flagged={flag('headline')}>
                        <TextField
                          testID="app-headline"
                          style={styles.input}
                          value={headline}
                          onChangeText={setHeadline}
                          placeholder={'“I listen more than I talk”'}
                          placeholderTextColor={theme.color.text.tertiary}
                          maxLength={140}
                          allowFontScaling
                          underlineColorAndroid="transparent"
                        />
                      </Field>
                    </>
                  ) : null}

                  {step === last ? (
                    <Field label="About" flagged={flag('about')}>
                      <TextField
                        testID="app-about"
                        style={[styles.input, styles.multiline]}
                        value={about}
                        onChangeText={setAbout}
                        placeholder="Why are you good at this?"
                        placeholderTextColor={theme.color.text.tertiary}
                        multiline
                        maxLength={2000}
                        allowFontScaling
                        underlineColorAndroid="transparent"
                      />
                    </Field>
                  ) : null}

                  {/*
                   * One nav block for every step, so the primary action is always
                   * in the same place and only its label changes. Nothing is
                   * validated on the way forward: the server owns what is missing,
                   * and a client-side gate here would be a second opinion that can
                   * disagree with it. The exceptions are the age refusal and a
                   * clearly unparseable date, both visible on screen.
                   */}
                  <View style={styles.nav}>
                    {step === last ? (
                      <Button
                        label="Submit Application"
                        busy={submit.isPending}
                        busyLabel="Submitting application"
                        onPress={send}
                        disabled={underage}
                        testID="app-submit"
                      />
                    ) : (
                      <Button
                        label="Continue"
                        onPress={() => setStep(current => Math.min(current + 1, last))}
                        disabled={underage || dobUnusable}
                        testID="app-next"
                      />
                    )}
                    {step > 0 ? (
                      <Button
                        label="Back"
                        kind="secondary"
                        onPress={() => setStep(current => Math.max(current - 1, 0))}
                        testID="app-previous"
                      />
                    ) : null}
                  </View>

                  {step === last ? (
                    <Text allowFontScaling style={styles.legal}>
                      We review every application. You will be able to see exactly
                      where yours stands, and if something is missing we will name it.
                    </Text>
                  ) : null}
                </>
              ) : null}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

/** A flagged field gets a marker, not a colour; the accent budget is spent. */
function Field({
  label,
  flagged,
  children,
}: {
  label: string;
  flagged: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text allowFontScaling style={[styles.label, flagged && styles.labelFlagged]}>
        {flagged ? `${label} (required)` : label}
      </Text>
      {children}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    welcome: {
      flex: 1,
      justifyContent: 'space-between',
    },
    welcomeHead: {
      paddingHorizontal: TOKENS.space.md,
    },
    back: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    block: {
      paddingHorizontal: BLOCK_PAD,
      gap: SOURCE_METRICS.welcomeGap,
    },
    welcomeTitle: {
      ...TOKENS.typography.wordmarkLarge,
      fontSize: 34,
      lineHeight: 38,
      color: t.color.text.onAccent,
    },
    welcomeBody: {
      ...TOKENS.typography.headlineMediumEmphasized,
      color: t.color.text.onAccent,
    },
    welcomeSub: {
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
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    formHost: {
      ...StyleSheet.absoluteFill,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
    },
    form: {
      paddingHorizontal: BLOCK_PAD,
      gap: SOURCE_METRICS.formGap,
    },
    checklist: {
      gap: SOURCE_METRICS.stepGap,
    },
    formBottom: {
      justifyContent: 'flex-end',
    },
    formCentred: {
      justifyContent: 'center',
    },
    nav: {
      gap: TOKENS.space.sm,
      paddingTop: TOKENS.space.sm,
    },
    missingBox: {
      padding: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
      gap: TOKENS.space.hair,
    },
    missingTitle: {
      ...TOKENS.typography.labelLargeEmphasized,
      color: t.color.text.primary,
      paddingBottom: TOKENS.space['2xs'],
    },
    missingItem: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    field: {
      gap: TOKENS.space['2xs'],
    },
    label: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    labelFlagged: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.primary,
    },
    input: {
      minHeight: 48,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.base,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    multiline: {
      minHeight: 110,
      paddingTop: TOKENS.space.md,
      textAlignVertical: 'top',
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
    },
    hint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    underageText: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.primary,
    },
    legal: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
  });
