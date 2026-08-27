import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Gender } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useMyApplication, useSubmitApplication } from '../api/provider';
import { ageFromIso, dobToIso, formatDobInput } from '../lib/dob';
import {
  APPLICATION_STEPS,
  firstFlaggedStep,
  missingOnStep,
} from '../lib/applicationSteps';
import { fadeSwap } from '../theme/motion';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { Stepper } from '../components/Stepper';
import { TextField } from '../components/TextField';

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

/** What the header says on each step. The stepper carries where you are. */
const STEP_INTRO: readonly string[] = [
  'Enough that somebody can decide whether to talk to you. Your date of birth is never shown.',
  'What you speak, and one line people will see first.',
  'The part a reviewer actually reads.',
];

/**
 * Applying to be a provider, in three steps.
 *
 * The age gate is here *and* in SQL, on purpose. The constraint in migration 006
 * is what makes an underage provider unrepresentable; this check exists so a
 * 17-year-old is told immediately rather than filling in six fields and being
 * refused at the end. Client-side is a courtesy, server-side is the rule.
 *
 * That promise is why the screen is stepped now rather than one scroll of six
 * fields. Date of birth was the third of those six, so "told immediately" meant
 * after a name, a gender and a birthday, and the two fields that take real
 * effort, the headline and the life story, came *after* the question that can end
 * the conversation. It is now in the first group of three, and nobody writes about
 * why they are good at listening before being told they are too young to.
 *
 * `missing_fields` comes back from the server and marks the inputs. Clarity's
 * applicants get "Something Missing" with no indication which thing, that is
 * the failure this screen exists to not repeat, and the steps make it sharper
 * rather than softer: a resubmit opens on the step holding the first flagged
 * field, and each step names only its own gaps. See src/lib/applicationSteps.ts.
 *
 * The steps are a UI grouping over ONE mutation. `useSubmitApplication` is
 * untouched, still sends all six fields at once, and is still the authority on
 * what is missing. Nothing is submitted until the last step.
 */
export function ProviderApplicationScreen({ onBack, onSubmitted }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: existing } = useMyApplication();
  const submit = useSubmitApplication();

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

  const underage = useMemo(
    () => {
      const age = dobIso === null ? null : ageFromIso(dobIso);
      return age !== null && age < 18;
    },
    [dobIso],
  );
  // Only once the field is full. Complaining at four digits is complaining about
  // a date that is still being typed.
  const dobUnusable = dob.length === 10 && dobIso === null;

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
            onSubmitted();
            return;
          }
          // Land on the gap rather than at the top. Without this the steps would
          // make the existing "we will name what is missing" promise WORSE than
          // the single scroll it replaced: named, and then two taps away.
          setStep(firstFlaggedStep(fields));
        },
      },
    );
  }, [submit, displayName, gender, dobIso, headline, languages, about, onSubmitted]);

  const flag = (field: string): boolean => missing.includes(field);
  // Only this step's gaps. The full list is on ProviderStatusScreen; repeating it
  // on every step would be six bullets above three fields.
  const gaps = missingOnStep(missing, step);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* A nav bar, not a Material Toolbar. See the same change in
          ProviderStatusScreen and ChatScreen. */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="application-back"
          accessibilityLabel="Back"
          press="none"
          highlight="ios"
          size={28}
          style={styles.back}>
          <Icon name="chevronLeft" size={22} />
        </Pressable>
        <Text allowFontScaling numberOfLines={1} style={styles.headerTitle}>
          Become a Provider
        </Text>
        <View style={styles.back} />
      </View>

      {/* Rules 2 and 4: the stepper persists across all three steps, the active
          label promotes in 150ms, and the marker walks a coral ramp over 220ms
          behind it. Outside the ScrollView on purpose: "persists" is the claim,
          and a stepper that scrolls away is not persisting. */}
      <View style={styles.stepperRow}>
        <Stepper
          testID="application-stepper"
          steps={APPLICATION_STEPS.map(s => s.title)}
          active={step}
        />
      </View>

      <ScrollView
        {...SCROLL_PHYSICS}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + TOKENS.space['2xl'] },
        ]}
        keyboardShouldPersistTaps="handled">
        {/* Rule 7: the intro changes with the step and cross-fades rather than
            cutting. Opacity only. */}
        <Animated.Text
          key={STEP_INTRO[step]}
          entering={fadeSwap}
          allowFontScaling
          style={styles.intro}>
          {STEP_INTRO[step]}
        </Animated.Text>

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
              <View style={styles.row}>
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

            {/* The age gate.
                It asked for ISO `YYYY-MM-DD` before this, which is a database
                format being taught to somebody applying for a job, nobody says
                their birthday leading with the year. It now accepts DD/MM/YYYY,
                the en-IN order, auto-formatted from a number pad, and converts on
                submit. The iOS-correct control is an inline UIDatePicker and it is
                deferred for dependency reasons rather than design ones: every RN
                date picker is a native module, and the house rule is that a new
                one needs its npm `time.modified` checked first. A picker can
                replace this later without touching the submit path, because
                `dobToIso` is what the server sees. The server is the authority
                regardless (migration 006's CHECK).
                It is in the FIRST step rather than the third of six so the refusal
                below arrives after three fields instead of after a life story. */}
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
                <Text testID="app-underage" allowFontScaling style={styles.block}>
                  Providers must be 18 or older. We cannot accept this application.
                </Text>
              ) : null}
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field label="Languages" flagged={flag('languages')}>
              <View style={styles.row}>
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
                placeholder="“I listen more than I talk”"
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

        {/* One nav block for every step, so the primary action is always in the
            same place and only its label changes. Nothing is validated on the way
            forward: the server owns what is missing, and a client-side gate here
            would be a second opinion that can disagree with it. The one exception
            is the age refusal, which is on screen by the time it matters. */}
        <View style={styles.nav}>
          {step === last ? (
            /* Rule 5. `disabled` is now `underage` alone: the pending half moved
               to `busy`, which holds the pill compressed at full opacity so the
               label it swaps to can be read. It used to render at 45%. */
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
              disabled={underage}
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
            We review every application. You will be able to see exactly where
            yours stands, and if something is missing we will name it.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** A flagged field gets a marker, not a colour, the accent budget is spent. */
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

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.color.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.color.border.hairline,
  },
  back: {
    width: 28,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  stepperRow: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.md,
  },
  body: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  // The gap lives here rather than as margins on the buttons, so Button stays
  // reusable inside sheets that set their own rhythm.
  nav: {
    gap: TOKENS.space.sm,
    paddingTop: TOKENS.space.sm,
  },
  intro: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
  },
  missingBox: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    gap: 2,
  },
  missingTitle: {
    ...TOKENS.typography.labelMedium,
    color: t.color.text.primary,
    paddingBottom: TOKENS.space['2xs'],
  },
  missingItem: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.secondary,
  },
  field: {
    gap: TOKENS.space['2xs'],
  },
  // Upper-case footnote, which is what an iOS grouped-form field label is.
  label: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.secondary,
  },
  labelFlagged: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.primary,
  },
  // `bg/sunken` at radius 10. It was `bg/raised`, which is #FFFFFF in light mode
  // and so is the page, and there was no border either, so all six fields on
  // this form had no visible box whatsoever, on the one screen that is nothing
  // but a form.
  input: {
    minHeight: 48,
    paddingHorizontal: TOKENS.space.md,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
  },
  multiline: {
    minHeight: 110,
    paddingTop: TOKENS.space.md,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: TOKENS.space['2xs'],
  },
  hint: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
  block: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.primary,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
});
