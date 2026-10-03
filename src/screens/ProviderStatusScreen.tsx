import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { fadeSwap, fadeSwapOut } from '../theme/motion';
import type { ApplicationStatus } from '../lib/database.types';
import { useMyApplication } from '../api/provider';
import { longDate } from '../lib/datetime';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';
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
 * under the listing. The fix is not faster review, it is telling people the
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

/*
 * No back barrier here any more, deliberately (navigation step 7): hardware
 * back is the native stack's, which pops this screen. The search guard that
 * the old barrier fenced off (useSearchBack) is focus-scoped now, so it is not
 * registered while Home is covered and cannot eat this screen's back press.
 */
export function ProviderStatusScreen({ onBack, onEdit }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data, isPending } = useMyApplication();

  const status = data?.status ?? 'draft';
  const copy = COPY[status];
  const actionable = status === 'draft' || status === 'needs_info';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* A nav bar, not a Material Toolbar: a bare 22pt chevron in a transparent
          target with a centred 17-semibold title, the same as the chat header and
          ProviderApplicationScreen now. The filled 40pt grey circle plus a
          left-aligned 15pt title was the strongest Android tell in the app. */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="status-back"
          accessibilityLabel="Back"
          press="none"
          highlight="dim"
          size={28}
          // `back` sets no radius, so the `dim` fill painted a solid 28x40
          // rectangle behind the chevron — the "filled grey box" this header
          // comment was written to get rid of, reappearing on press. Oblong box,
          // so the pill resolves to a 28-wide stadium, not a true circle.
          // https://developer.android.com/training/material/animations
          shape="circle"
          style={styles.back}>
          <Icon name="back" size={TOKENS.icon.md} color={theme.color.text.secondary} />
        </Pressable>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight} allowFontScaling numberOfLines={1} style={styles.headerTitle}>
          Your Application
        </Text>
        {/* Balances the chevron so the title is centred on the bar rather than on
            the space left over beside it. */}
        <View style={styles.back} />
      </View>

      {isPending ? (
        <View style={styles.state}>
          <LoadingIndicator size={48} />
        </View>
      ) : (
        <View style={styles.body}>
          {/* Rule 7: both of these change when the query resolves and again on
              every refetch that finds a new status, and they used to hard-cut. An
              application status is the one thing on this screen somebody is
              actually reading, so the change should be visible as a change.
              Opacity only, keyed on the content so React remounts and Reanimated
              fades the new string in. Nothing scales and nothing moves, which is
              what makes it safe on a paragraph whose height varies with its
              status. */}
          <Animated.Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized}
            key={copy.title}
            entering={fadeSwap} exiting={fadeSwapOut}
            testID="application-status"
            allowFontScaling
            style={styles.title}>
            {copy.title}
          </Animated.Text>
          <Animated.Text
            key={copy.body}
            entering={fadeSwap} exiting={fadeSwapOut}
            allowFontScaling
            style={styles.copy}>
            {copy.body}
          </Animated.Text>

          {data?.submitted_at != null ? (
            <Text allowFontScaling style={styles.meta}>
              {/* A bare toLocaleDateString() gives '8/22/2026' under Hermes
                  whatever the device's region, because Hermes ships one locale.
                  longDate() names the month. */}
              Submitted {longDate(data.submitted_at)}
            </Text>
          ) : null}

          {(data?.missing_fields ?? []).length > 0 ? (
            <View testID="status-missing" style={styles.missingBox}>
              <Text allowFontScaling style={styles.missingTitle}>
                Still Needed
              </Text>
              {/* The bullet is a sibling in a row, not a '• ' prefix inside the
                  string: with the glyph in its own column a wrapped line aligns
                  under the text rather than under the bullet. */}
              {(data?.missing_fields ?? []).map(f => (
                <View key={f} style={styles.bulletRow}>
                  <Text allowFontScaling style={styles.bullet}>
                    •
                  </Text>
                  <Text allowFontScaling style={styles.missingItem}>
                    {FIELD_LABEL[f] ?? f}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {data?.reviewer_note != null && data.reviewer_note !== '' ? (
            <View style={styles.noteBox}>
              <Text allowFontScaling style={styles.missingTitle}>
                From the Reviewer
              </Text>
              <Text testID="reviewer-note" allowFontScaling style={styles.missingItem}>
                {data.reviewer_note}
              </Text>
            </View>
          ) : null}

          <View style={styles.spacer} />

          {actionable ? (
            <Button
              label={status === 'needs_info' ? 'Fix and Resubmit' : 'Finish Application'}
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
    ...TOKENS.typography.textLgSemiBoldTight,
    color: t.color.text.primary,
    flex: 1,
    textAlign: 'center',
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
    ...TOKENS.typography.titleLargeEmphasized,
    color: t.color.text.primary,
  },
  copy: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.secondary,
  },
  meta: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  missingBox: {
    marginTop: TOKENS.space.sm,
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    gap: TOKENS.space.hair,
  },
  // `bg/sunken`, matching missingBox. It was `bg/raised`, which is #FFFFFF in
  // light mode and so is the page, so the reviewer's note had no box at all, on
  // the one screen where a rejected applicant is looking for exactly that box.
  noteBox: {
    padding: TOKENS.space.md,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
    gap: TOKENS.space.hair,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: TOKENS.space['2xs'],
  },
  bullet: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  missingTitle: {
    ...TOKENS.typography.labelLargeEmphasized,
    color: t.color.text.primary,
    paddingBottom: TOKENS.space['2xs'],
  },
  missingItem: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
});
