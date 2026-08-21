import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import type { ApplicationStatus } from '../lib/database.types';
import { useMyApplication } from '../api/provider';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';

interface Props {
  onBack: () => void;
  onEdit: () => void;
}

const FIELD_LABEL: Record<string, string> = {
  display_name: 'Your name',
  gender: 'Gender',
  date_of_birth: 'Date of birth',
  headline: 'One line about you',
  languages: 'Languages',
  about: 'About you',
};

/**
 * Every state says what it is and what happens next. No state is a dead end.
 *
 * This screen is the direct answer to the most instructive thing in Clarity's
 * store reviews: an applicant two weeks into "Profile Under Review / Something
 * Missing", mailing support, hearing nothing, and finally writing it up publicly
 * under the listing. The fix is not faster review — it is telling people the
 * truth continuously, and making `needs_info` something they can resolve alone.
 */
const COPY: Record<ApplicationStatus, { title: string; body: string }> = {
  draft: {
    title: 'Not submitted yet',
    body: 'Your application is saved but has not reached us. Finish the remaining fields and submit it.',
  },
  submitted: {
    title: 'With us now',
    body: 'We have your application. We review every one by hand, so this takes a few days rather than minutes. You do not need to do anything.',
  },
  under_review: {
    title: 'Being reviewed',
    body: 'Someone is reading it now. If we need anything else, this screen will say exactly what.',
  },
  needs_info: {
    title: 'We need one more thing',
    body: 'Add what is listed below and submit again. You do not need to contact anyone.',
  },
  approved: {
    title: 'You are in',
    body: 'Your profile is live. Turn yourself available when you are ready to talk to someone.',
  },
  rejected: {
    title: 'Not this time',
    body: 'We are not able to accept this application. If we said why, it is below.',
  },
};

export function ProviderStatusScreen({ onBack, onEdit }: Props) {
  const insets = useSafeAreaInsets();
  const { data, isPending } = useMyApplication();

  const status = data?.status ?? 'draft';
  const copy = COPY[status];
  const actionable = status === 'draft' || status === 'needs_info';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="status-back"
          accessibilityLabel="Back"
          press="chip"
          size={40}
          style={styles.back}>
          <Icon glyph="chevron-left" size={16} />
        </Pressable>
        <Text allowFontScaling style={styles.headerTitle}>
          Your application
        </Text>
      </View>

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={TOKENS.color.text.secondary} />
        </View>
      ) : (
        <View style={styles.body}>
          <Text testID="application-status" allowFontScaling style={styles.title}>
            {copy.title}
          </Text>
          <Text allowFontScaling style={styles.copy}>
            {copy.body}
          </Text>

          {data?.submitted_at != null ? (
            <Text allowFontScaling style={styles.meta}>
              Submitted {new Date(data.submitted_at).toLocaleDateString()}
            </Text>
          ) : null}

          {(data?.missing_fields ?? []).length > 0 ? (
            <View testID="status-missing" style={styles.missingBox}>
              <Text allowFontScaling style={styles.missingTitle}>
                Still needed
              </Text>
              {(data?.missing_fields ?? []).map(f => (
                <Text key={f} allowFontScaling style={styles.missingItem}>
                  • {FIELD_LABEL[f] ?? f}
                </Text>
              ))}
            </View>
          ) : null}

          {data?.reviewer_note != null && data.reviewer_note !== '' ? (
            <View style={styles.noteBox}>
              <Text allowFontScaling style={styles.missingTitle}>
                From the reviewer
              </Text>
              <Text testID="reviewer-note" allowFontScaling style={styles.missingItem}>
                {data.reviewer_note}
              </Text>
            </View>
          ) : null}

          <View style={styles.spacer} />

          {actionable ? (
            <Button
              label={status === 'needs_info' ? 'Fix and resubmit' : 'Finish my application'}
              onPress={onEdit}
              testID="status-edit"
            />
          ) : null}
          <Button label="Back" kind="secondary" onPress={onBack} />
        </View>
      )}
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.sunken,
  },
  headerTitle: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
  },
  body: {
    flex: 1,
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space['2xl'],
    paddingBottom: TOKENS.space.lg,
    gap: TOKENS.space.sm,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...TOKENS.typography.titleMedium,
    color: TOKENS.color.text.primary,
  },
  copy: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  meta: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  missingBox: {
    marginTop: TOKENS.space.sm,
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.sunken,
    gap: 2,
  },
  noteBox: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.raised,
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
  spacer: {
    flex: 1,
  },
});
