import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useStore } from '../store/useStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { legalUrl } from '../lib/legal';
import { isUsernameLocallyValid, usernameLocalStatus } from '../lib/username';
import { CLAY_SEEDS, CLAY_IMAGES, type ClaySeed } from '../lib/clayAvatars';
import { useAcceptAllPendingPolicies, usePendingPolicies } from '../api/policy';
import {
  AGE_BRACKETS,
  setMemberAgeBracket,
  useCheckDisplayName,
  useClaimMemberProfile,
  type AgeBracket,
} from '../api/profileSetup';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TextField } from '../components/TextField';
import { LoadingIndicator } from '../components/LoadingIndicator';

interface Props {
  onDone: () => void;
  /**
   * Show the age-bracket picker as step 0.
   *
   * True when the member has not yet declared an age band (migration 043).
   * The picker is skipped automatically if the bracket was already saved
   * during the inline onboarding flow (Credential Manager path).
   */
  needsAge?: boolean;
  /**
   * Show the username + avatar step.
   *
   * False for an existing member who only needs to declare their age band
   * (predates migration 043 and already has a completed profile). In that
   * case the screen skips to the picker immediately and calls `onDone` once
   * the bracket is saved, without showing the username form at all.
   */
  needsUsername?: boolean;
}

export function ProfileSetupScreen({
  onDone,
  needsAge = false,
  needsUsername = true,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const setNotice = useStore(s => s.setNotice);

  /*
   * Two-step flow when both flags are true: age first, then username+avatar.
   * When only `needsAge` is true (existing member): age only, then onDone.
   * When only `needsUsername` is true: skip straight to the username form.
   */
  const [step, setStep] = useState<'age' | 'profile'>(needsAge ? 'age' : 'profile');
  const [ageBracket, setAgeBracket] = useState<AgeBracket | null>(null);
  const [bracketSaving, setBracketSaving] = useState(false);

  const onSaveAge = useCallback(
    async (bracket: AgeBracket) => {
      if (bracketSaving) {
        return;
      }
      setBracketSaving(true);
      try {
        await setMemberAgeBracket(bracket);
        if (needsUsername) {
          setStep('profile');
        } else {
          onDone();
        }
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not save. Please try again.');
      } finally {
        setBracketSaving(false);
      }
    },
    [bracketSaving, needsUsername, onDone, setNotice],
  );

  const [displayName, setDisplayName] = useState('');
  const [avatarSeed, setAvatarSeed] = useState<ClaySeed | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);

  const localOk = isUsernameLocallyValid(displayName);
  const { data: nameCheck, isFetching: checkingName } = useCheckDisplayName(
    displayName,
    localOk,
  );

  const claim = useClaimMemberProfile();
  const { data: pending = [] } = usePendingPolicies();
  const acceptAll = useAcceptAllPendingPolicies();

  const statusLine = useMemo(() => {
    const local = usernameLocalStatus(displayName);
    if (local === 'idle') {
      return null;
    }
    if (local === 'too_short') {
      return { text: 'At least 3 characters', tone: 'bad' as const };
    }
    if (local === 'invalid_chars') {
      return { text: 'Letters, numbers, and underscores only', tone: 'bad' as const };
    }
    if (checkingName) {
      return { text: 'Checking…', tone: 'muted' as const };
    }
    if (nameCheck?.status === 'available') {
      return { text: 'Yay! great choice', tone: 'good' as const };
    }
    if (nameCheck?.status === 'taken') {
      return { text: 'Oops! already taken', tone: 'bad' as const };
    }
    if (nameCheck?.status === 'invalid') {
      return { text: nameCheck.message || 'Oops! already taken', tone: 'bad' as const };
    }
    return null;
  }, [displayName, checkingName, nameCheck]);

  const nameReady = localOk && nameCheck?.status === 'available';
  const saving = claim.isPending || acceptAll.isPending;

  const onContinue = useCallback(async () => {
    if (saving) {
      return;
    }
    if (!nameReady) {
      setNotice('Pick a username that is still free.');
      return;
    }
    if (avatarSeed === null) {
      setNotice('Pick a look to continue.');
      return;
    }
    if (!termsChecked) {
      setNotice('Please accept the terms & conditions to continue.');
      return;
    }
    try {
      await claim.mutateAsync({ displayName, avatarSeed });
      const ids = pending.map(p => p.id);
      if (ids.length > 0) {
        await acceptAll.mutateAsync(ids);
      }
      onDone();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not continue. Please try again.');
    }
  }, [
    saving,
    nameReady,
    avatarSeed,
    termsChecked,
    claim,
    displayName,
    pending,
    acceptAll,
    onDone,
    setNotice,
  ]);

  const openTerms = useCallback(() => {
    void Linking.openURL(legalUrl('terms'));
  }, []);

  const openPrivacy = useCallback(() => {
    void Linking.openURL(legalUrl('privacy'));
  }, []);

  if (step === 'age') {
    /*
     * Age-bracket step: four M3 filter chips.
     *
     * No KeyboardAvoidingView — there is no text input here. The chip row is
     * self-contained and always fits the screen.
     *
     * Tapping a chip sets the bracket and immediately saves it (one tap, no
     * separate Continue). The button at the bottom is the accessible fallback
     * and the recovery path after a transient error.
     */
    return (
      <View style={[styles.root, styles.agePage, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling style={styles.title}>
          How old are you?
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          A rough band is enough. Pappal is for adults.
        </Text>

        <View style={styles.ageChips}>
          {AGE_BRACKETS.map(bracket => {
            const selected = ageBracket === bracket;
            return (
              <Pressable
                key={bracket}
                onPress={() => {
                  setAgeBracket(bracket);
                  void onSaveAge(bracket);
                }}
                disabled={bracketSaving}
                testID={`profile-age-chip-${bracket}`}
                accessibilityRole="radio"
                checked={selected}
                accessibilityLabel={bracket}
                press="none"
                highlight="dim"
                style={[
                  styles.ageChip,
                  selected && styles.ageChipSelected,
                ]}>
                <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
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

        {bracketSaving ? (
          <View style={styles.ageSavingRow}>
            <LoadingIndicator size={20} containerColor="transparent" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        {...SCROLL_PHYSICS}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling style={styles.title}>
          Claim your username
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          This is how you&apos;ll show up in Pappal.
        </Text>

        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.fieldLabel}>
          Username
        </Text>
        <TextField
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="username"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={24}
          testID="profile-setup-username"
          style={styles.field}
        />
        {statusLine ? (
          <Text
            allowFontScaling
            style={[
              styles.status,
              statusLine.tone === 'good'
                ? styles.statusGood
                : statusLine.tone === 'bad'
                  ? styles.statusBad
                  : styles.statusMuted,
            ]}>
            {statusLine.text}
          </Text>
        ) : null}

        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.section}>
          Pick a look
        </Text>
        <View style={styles.avatarGrid}>
          {CLAY_SEEDS.map(seed => {
            const selected = avatarSeed === seed;
            return (
              <Pressable
                key={seed}
                onPress={() => setAvatarSeed(seed)}
                press="none"
                highlight="dim"
                accessibilityRole="button"
                accessibilityLabel={
                  selected ? `Avatar ${seed}, selected` : `Avatar ${seed}`
                }
                style={[styles.avatarCell, selected && styles.avatarCellSelected]}>
                <Image source={CLAY_IMAGES[seed]} style={styles.avatarImg} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.termsRow}>
          <Pressable
            onPress={() => setTermsChecked(v => !v)}
            press="none"
            highlight="dim"
            accessibilityRole="checkbox"
            checked={termsChecked}
            accessibilityLabel="Accept terms and privacy"
            testID="profile-setup-terms"
            size={22}
            style={styles.checkboxHit}>
            <View style={[styles.checkbox, termsChecked && styles.checkboxOn]}>
              {termsChecked ? (
                <Icon name="check" size={14} color={theme.color.text.onAccent} />
              ) : null}
            </View>
          </Pressable>
          <Text allowFontScaling style={styles.termsText}>
            I agree to the{' '}
            <Text
              style={styles.link}
              onPress={openTerms}
              accessibilityRole="link">
              Terms
            </Text>{' '}
            and{' '}
            <Text
              style={styles.link}
              onPress={openPrivacy}
              accessibilityRole="link">
              Privacy Policy
            </Text>
          </Text>
        </View>
        <Button
          label="Continue"
          onPress={() => {
            void onContinue();
          }}
          // Name must be free; avatar + T&C are enforced in onContinue with
          // alerts so a missed checkbox tap never leaves a dead button.
          disabled={!nameReady || saving}
          busy={saving}
          busyLabel="Saving profile"
          testID="profile-setup-continue"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    agePage: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.xl,
      gap: TOKENS.space.md,
    },
    /*
     * M3 filter chips: tonal fill on selection.
     *
     * On a light surface (`t.color.bg.base` in light mode) the resting chip
     * reads as a bordered pill. Selected gets the accent background, matching
     * the product's brand coral rather than a raw white — this surface is light,
     * not dark, so white fill would vanish.
     */
    ageChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
      marginTop: TOKENS.space.sm,
    },
    ageChip: {
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.sunken,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: TOKENS.interaction.minTarget,
    },
    /*
     * The selected fill is the DEEP step of the accent, not the bright one.
     *
     * `ageChipLabelSelected` is `text/onAccent` over this, and
     * titleMediumEmphasized is 16dp Bold.
     * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
     * visibility"): "If the text is smaller than 18sp, or if the text is bold
     * and smaller than 14sp, use foreground and background colors that result
     * in a color contrast ratio of at least 4.5:1. For all other text, set the
     * color contrast ratio to at least 3:1." 16dp is smaller than 18sp, so this
     * label takes 4.5:1 — being bold does not promote it, the bold clause only
     * pulls MORE text down to 4.5 (anything bold under 14sp).
     *
     * bg/accent measured 3.44:1 light and 2.59:1 dark here, which fails 4.5:1 in
     * both and the 3:1 fallback in dark as well. design/tokens.json says it on
     * the token: bg/accent "must NEVER sit under small white text; that is what
     * bg/accentStrong is for". bg/accentStrong is 5.19:1 / 6.13:1.
     *
     * The fill moves rather than the label because this surface is light and the
     * chip's fill IS the selection signal — and because the only ink that would
     * work is `text/primary`, which is 4.95:1 light but 2.70:1 dark (in dark it
     * IS white), so it is not an answer, just a different failure.
     */
    ageChipSelected: {
      backgroundColor: t.color.bg.accentStrong,
      borderColor: t.color.bg.accentStrong,
    },
    ageChipLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
    },
    ageChipLabelSelected: {
      color: t.color.text.onAccent,
    },
    ageSavingRow: {
      alignItems: 'center',
      paddingVertical: TOKENS.space.sm,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.xl,
      gap: TOKENS.space.md,
    },
    title: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
      fontFamily: 'Geist-SemiBold',
    },
    subtitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      marginBottom: TOKENS.space.sm,
    },
    fieldLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      fontFamily: 'Geist-SemiBold',
      marginTop: TOKENS.space.md,
      marginBottom: TOKENS.space.xs,
    },
    field: {
      minHeight: 56,
      ...TOKENS.typography.bodyLarge,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.sunken,
      color: t.color.text.primary,
    },
    status: {
      ...TOKENS.typography.bodyLarge,
      marginTop: TOKENS.space.xs,
      fontFamily: 'Geist-Regular',
    },
    statusGood: {
      color: t.color.text.positive,
    },
    statusBad: {
      color: t.color.state.danger,
    },
    statusMuted: {
      color: t.color.text.tertiary,
    },
    section: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      marginTop: TOKENS.space.md,
      fontFamily: 'Geist-Regular',
    },
    avatarGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.sm,
    },
    avatarCell: {
      width: 72,
      height: 72,
      borderRadius: 36,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarCellSelected: {
      borderColor: t.color.border.accent,
    },
    avatarImg: {
      width: '100%',
      height: '100%',
    },
    termsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      marginBottom: TOKENS.space.sm,
    },
    checkboxHit: {
      // Keep the visible box aligned to the text. Pressable's size prop expands
      // this 22dp visual to the Android 48dp touch target with hitSlop.
      width: 22,
      height: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.sunken,
    },
    // Same fill as `ageChipSelected`, for a weaker but still real reason: the
    // 14dp check inside is a non-text mark at the 3:1 minimum rather than a
    // label at 4.5:1, and bg/accent clears 3:1 in light (3.44:1) but not in dark
    // (2.59:1) — so the tick was the faintest thing on the row in the theme
    // where it mattered most. It is also the same "on" state as the age chip one
    // screen section up, and two selected affordances on one screen answering to
    // two different corals is how a palette stops meaning anything.
    checkboxOn: {
      backgroundColor: t.color.bg.accentStrong,
      borderColor: t.color.bg.accentStrong,
    },
    termsText: {
      flex: 1,
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
      lineHeight: 22,
    },
    link: {
      color: t.color.text.accent,
      fontFamily: 'Geist-Regular',
    },
    footer: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
  });
