import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import type { Gender } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { useMyApplication, useSubmitApplication } from '../api/provider';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';

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
  display_name: 'Your name',
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  headline: 'One line about you',
  languages: 'Languages',
  about: 'About you',
};

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && value === d.toISOString().slice(0, 10);
}

function yearsSince(iso: string): number {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return (Date.now() - then) / (365.25 * 24 * 3600 * 1000);
}

/**
 * Applying to be a provider.
 *
 * The age gate is here *and* in SQL, on purpose. The constraint in migration 006
 * is what makes an underage provider unrepresentable; this check exists so a
 * 17-year-old is told immediately rather than filling in six fields and being
 * refused at the end. Client-side is a courtesy, server-side is the rule.
 *
 * `missing_fields` comes back from the server and marks the inputs. Clarity's
 * applicants get "Something Missing" with no indication which thing — that is
 * the failure this screen exists to not repeat.
 */
export function ProviderApplicationScreen({ onBack, onSubmitted }: Props) {
  const insets = useSafeAreaInsets();
  const { data: existing } = useMyApplication();
  const submit = useSubmitApplication();

  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState('');
  const [headline, setHeadline] = useState('');
  const [about, setAbout] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>(existing?.missing_fields ?? []);

  const underage = useMemo(
    () => isValidIsoDate(dob) && yearsSince(dob) < 18,
    [dob],
  );
  const dobUnusable = dob !== '' && !isValidIsoDate(dob);

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
        dateOfBirth: isValidIsoDate(dob) ? dob : null,
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
          }
        },
      },
    );
  }, [submit, displayName, gender, dob, headline, languages, about, onSubmitted]);

  const flag = (field: string): boolean => missing.includes(field);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="application-back"
          accessibilityLabel="Back"
          style={styles.back}>
          <Icon glyph="chevron-left" size={16} />
        </Pressable>
        <Text allowFontScaling style={styles.headerTitle}>
          Become a provider
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + TOKENS.space['2xl'] },
        ]}
        keyboardShouldPersistTaps="handled">
        <Text allowFontScaling style={styles.intro}>
          People come here to be listened to. Tell us enough that someone can
          decide whether to talk to you.
        </Text>

        {missing.length > 0 ? (
          <View testID="application-missing" style={styles.missingBox}>
            <Text allowFontScaling style={styles.missingTitle}>
              Still needed
            </Text>
            {missing.map(f => (
              <Text key={f} allowFontScaling style={styles.missingItem}>
                • {FIELD_LABEL[f] ?? f}
              </Text>
            ))}
          </View>
        ) : null}

        <Field label="Your name" flagged={flag('display_name')}>
          <TextInput
            testID="app-name"
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="What should people call you?"
            placeholderTextColor={TOKENS.color.text.secondary}
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

        {/* The age gate. Plain text input rather than a date picker dependency —
            the format is shown, and the server is the authority regardless. */}
        <Field label="Date of birth" flagged={flag('date_of_birth')}>
          <TextInput
            testID="app-dob"
            style={styles.input}
            value={dob}
            onChangeText={setDob}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={TOKENS.color.text.secondary}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            allowFontScaling
            underlineColorAndroid="transparent"
          />
          {dobUnusable ? (
            <Text allowFontScaling style={styles.hint}>
              Use YYYY-MM-DD, for example 1998-04-23.
            </Text>
          ) : null}
          {underage ? (
            <Text testID="app-underage" allowFontScaling style={styles.block}>
              Providers must be 18 or older. We cannot accept this application.
            </Text>
          ) : null}
        </Field>

        <Field label="One line about you" flagged={flag('headline')}>
          <TextInput
            testID="app-headline"
            style={styles.input}
            value={headline}
            onChangeText={setHeadline}
            placeholder="“I listen more than I talk”"
            placeholderTextColor={TOKENS.color.text.secondary}
            maxLength={140}
            allowFontScaling
            underlineColorAndroid="transparent"
          />
        </Field>

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

        <Field label="About you" flagged={flag('about')}>
          <TextInput
            testID="app-about"
            style={[styles.input, styles.multiline]}
            value={about}
            onChangeText={setAbout}
            placeholder="Why are you good at this?"
            placeholderTextColor={TOKENS.color.text.secondary}
            multiline
            maxLength={2000}
            allowFontScaling
            underlineColorAndroid="transparent"
          />
        </Field>

        <Button
          label={submit.isPending ? 'Submitting…' : 'Submit application'}
          onPress={send}
          disabled={submit.isPending || underage}
          testID="app-submit"
        />
        <Text allowFontScaling style={styles.legal}>
          We review every application. You will be able to see exactly where
          yours stands, and if something is missing we will name it.
        </Text>
      </ScrollView>
    </View>
  );
}

/** A flagged field gets a marker, not a colour — the accent budget is spent. */
function Field({
  label,
  flagged,
  children,
}: {
  label: string;
  flagged: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text allowFontScaling style={[styles.label, flagged && styles.labelFlagged]}>
        {flagged ? `${label} — needed` : label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.color.border.hairline,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.sunken,
  },
  headerTitle: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
  },
  body: {
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space.lg,
    gap: TOKENS.space.md,
  },
  intro: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  missingBox: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.sunken,
    gap: 2,
  },
  missingTitle: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
    paddingBottom: TOKENS.space['2xs'],
  },
  missingItem: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
  field: {
    gap: TOKENS.space['2xs'],
  },
  label: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
  },
  labelFlagged: {
    ...TOKENS.typography.labelSmall,
    color: TOKENS.color.text.primary,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.raised,
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.primary,
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
    color: TOKENS.color.text.secondary,
  },
  block: {
    ...TOKENS.typography.labelSmall,
    color: TOKENS.color.text.primary,
  },
  legal: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
});
