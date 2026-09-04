import React, { useCallback, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { CLAY_SEEDS, CLAY_IMAGES, type ClaySeed } from '../lib/clayAvatars';
import {
  useSavePan,
  useCompleteProviderOnboarding,
  useSetClayAvatar,
} from '../api/provider';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TextField } from '../components/TextField';

interface Props {
  onBack: () => void;
  /** Kept for App.tsx; the real transition is the role flip → provider tree. */
  onSubmitted: () => void;
}

const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi'];

type Phase = 'verify' | 'profile' | 'done';

/**
 * Five letters, four digits, a letter. Checked here only to enable the button —
 * the real verification is the Income Tax Department's, server-side.
 */
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Becoming a provider, as ONE continuous flow (no second welcome/bloom).
 *
 * Reached straight after phone sign-in (App.tsx `pendingProviderApply`). The
 * order the product wants (Amit, 2026-09-03):
 *
 *   1. Verify with Cashfree — one consent returns a verified PAN, bank, and DOB
 *      (identity/KYC), so nothing here is typed. `cashfree-onboarding-complete`
 *      writes the DOB that the auto-approve age gate reads.
 *   2. Profile — the card fields the member chooses you by: display name,
 *      headline, languages, about. A photo is optional; everything else is not.
 *   3. Go live — `complete_provider_onboarding` (migration 051) sets role=provider
 *      + identity_verified_at in one call. The role flip re-renders the app into
 *      the provider tree, which IS the navigation to the provider home; there is
 *      no admin review (Cashfree KYC is the vetting; the admin console keeps an
 *      after-the-fact Providers list + suspend).
 */
export function ProviderApplicationScreen({ onBack, onSubmitted }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const setNotice = useStore(s => s.setNotice);

  const [phase, setPhase] = useState<Phase>('verify');
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [about, setAbout] = useState('');
  const [avatarSeed, setAvatarSeed] = useState<ClaySeed | null>(null);

  const savePan = useSavePan();
  const [pan, setPan] = useState('');
  const [panError, setPanError] = useState<string | null>(null);
  const complete = useCompleteProviderOnboarding();
  const setClay = useSetClayAvatar();

  const toggleLanguage = useCallback((language: string) => {
    setLanguages(prev =>
      prev.includes(language) ? prev.filter(l => l !== language) : [...prev, language],
    );
  }, []);

  /**
   * PAN, and only PAN.
   *
   * This step used to open Cashfree's 1-Click consent sheet, which returns the
   * same PAN, name and DOB behind an OTP. That sheet is broken in Cashfree's
   * sandbox — their own consent page sends `x-session-id` to their own API,
   * which does not allow the header in its CORS preflight (reproduced with
   * curl, 2026-09-05). Nothing on our side can route around it.
   *
   * PAN 360 Advanced returns the same three facts over a plain server-to-server
   * call, so it cannot fail that way, and it is less data about the person than
   * 1-Click or Mobile 360 collect — a PAN, a name and a birth date, which is
   * exactly what the age gate and TDS need and nothing more. 1-Click stays in
   * `useCashfreeVerification` for when Cashfree fixes their sandbox; it is no
   * longer the road onboarding depends on.
   */
  const onVerifyPan = useCallback(() => {
    Keyboard.dismiss();
    setPanError(null);
    savePan.mutate(pan, {
      onSuccess: status => {
        if (status === 'verified') {
          setPhase('profile');
          return;
        }
        // Only a real verification advances. A 'pending' or 'failed' PAN that
        // moved the user on would let them fill the whole profile and be
        // refused by `complete_provider_onboarding` at the very end, with no
        // way back to the step that failed — the dead end this flow had.
        setPanError(
          status === 'failed'
            ? 'That PAN could not be verified. Check the number and try again.'
            : 'We could not reach the verification service. Please try again.',
        );
      },
      onError: () => setPanError('Something went wrong. Please try again.'),
    });
  }, [pan, savePan]);

  const profileReady =
    displayName.trim().length > 0 &&
    headline.trim().length > 0 &&
    languages.length > 0 &&
    about.trim().length > 0;

  const onGoLive = useCallback(() => {
    Keyboard.dismiss();
    void (async () => {
      try {
        // Photo is optional — save it only if one was picked.
        if (avatarSeed !== null) {
          await setClay.mutateAsync(avatarSeed);
        }
        await complete.mutateAsync({
          displayName: displayName.trim(),
          headline: headline.trim(),
          languages,
          about: about.trim(),
        });
        setPhase('done');
      } catch {
        // useCompleteProviderOnboarding surfaces the reason via a notice.
      }
    })();
  }, [avatarSeed, setClay, complete, displayName, headline, languages, about]);

  // ── Phase: verify ────────────────────────────────────────────────────────
  if (phase === 'verify') {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header onBack={onBack} />
        <View style={styles.verifyBody}>
          <View style={styles.verifyIcon}>
            <Icon name="wallet" size={30} color={theme.color.text.onAccent} />
          </View>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
            allowFontScaling
            style={styles.title}>
            Verify it&apos;s you
          </Text>
          <Text allowFontScaling style={styles.verifyBodyText}>
            Your PAN confirms who you are and your age, and it is what lets us pay
            you without deducting 5% TDS. We check it with the Income Tax
            Department and keep only the result.
          </Text>
          <TextField
            value={pan}
            onChangeText={t => setPan(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
            placeholder="ABCDE1234F"
            placeholderTextColor={theme.color.text.tertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={10}
            allowFontScaling
            accessibilityLabel="PAN number"
            testID="provider-pan"
            style={styles.panField}
          />
          {panError !== null ? (
            <Text allowFontScaling style={styles.verifyHint}>
              {panError}
            </Text>
          ) : null}
        </View>
        <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.md }]}>
          <Button
            label="Verify PAN"
            onPress={onVerifyPan}
            disabled={!PAN_SHAPE.test(pan)}
            busy={savePan.isPending}
            busyLabel="Verifying"
            testID="provider-verify"
          />
        </View>
      </View>
    );
  }

  // ── Phase: done ──────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Animated.View
        entering={FadeIn.duration(220)}
        style={[styles.root, styles.doneRoot, { paddingTop: insets.top }]}>
        <View style={styles.doneCheck}>
          <Icon name="check" size={34} color={theme.color.text.onAccent} />
        </View>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          allowFontScaling
          style={styles.title}>
          You&apos;re live
        </Text>
        <Text allowFontScaling style={styles.doneBody}>
          You&apos;re listed now. Turn yourself available from your home to start
          taking conversations.
        </Text>
        <View style={styles.doneFooter}>
          <Button label="Go to my home" onPress={onSubmitted} testID="provider-done" />
        </View>
      </Animated.View>
    );
  }

  // ── Phase: profile ───────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header onBack={() => setPhase('verify')} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + TOKENS.space.md }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          allowFontScaling
          style={styles.title}>
          Your public profile
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          This is all a member sees. Your real name is never shown.
        </Text>

        <Field label="Stage name">
          <TextField
            testID="provider-name"
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="The name members will see"
            placeholderTextColor={theme.color.text.tertiary}
            maxLength={40}
            allowFontScaling
            underlineColorAndroid="transparent"
          />
        </Field>

        <Field label="Headline">
          <TextField
            testID="provider-headline"
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

        <Field label="Languages">
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

        <Field label="About">
          <TextField
            testID="provider-about"
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

        <Field label="Photo (optional)">
          <View style={styles.avatarGrid}>
            {CLAY_SEEDS.map(seed => {
              const selected = avatarSeed === seed;
              return (
                <Pressable
                  key={seed}
                  onPress={() => setAvatarSeed(selected ? null : seed)}
                  press="none"
                  highlight="ios"
                  accessibilityRole="button"
                  accessibilityLabel={selected ? `Avatar ${seed}, selected` : `Avatar ${seed}`}
                  style={[styles.avatarCell, selected && styles.avatarCellSelected]}>
                  <Image source={CLAY_IMAGES[seed]} style={styles.avatarImg} />
                </Pressable>
              );
            })}
          </View>
        </Field>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.md }]}>
        <Button
          label="Go live"
          onPress={() => {
            if (!profileReady) {
              setNotice('Fill your name, headline, a language, and about to go live.');
              return;
            }
            onGoLive();
          }}
          disabled={!profileReady}
          busy={complete.isPending || setClay.isPending}
          busyLabel="Going live"
          testID="provider-golive"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        testID="application-back"
        accessibilityLabel="Back"
        press="none"
        highlight="ios"
        style={styles.back}>
        <Icon name="chevronLeft" size={22} />
      </Pressable>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text allowFontScaling style={styles.fieldLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    header: { paddingHorizontal: TOKENS.space.md, paddingTop: TOKENS.space.xs },
    back: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
    verifyBody: {
      flex: 1,
      paddingHorizontal: TOKENS.space.lg,
      justifyContent: 'center',
      gap: TOKENS.space.md,
    },
    verifyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: t.color.bg.accent,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: TOKENS.space.xs,
    },
    verifyBodyText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
    },
    panField: {
      alignSelf: 'stretch',
      marginTop: TOKENS.space.lg,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      textAlign: 'center',
      letterSpacing: 2,
    },
    verifyHint: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.tertiary,
    },
    scroll: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.md,
      gap: TOKENS.space.md,
    },
    title: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    subtitle: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      marginBottom: TOKENS.space.xs,
    },
    field: { gap: TOKENS.space['2xs'] },
    fieldLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.secondary },
    input: {
      minHeight: 52,
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.field,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.strong,
      backgroundColor: t.color.bg.base,
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    multiline: { minHeight: 110, paddingTop: TOKENS.space.md, textAlignVertical: 'top' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: TOKENS.space['2xs'] },
    avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: TOKENS.space.sm },
    avatarCell: {
      width: 64,
      height: 64,
      borderRadius: 32,
      overflow: 'hidden',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    avatarCellSelected: { borderColor: t.color.border.accent },
    avatarImg: { width: '100%', height: '100%' },
    footer: {
      paddingHorizontal: TOKENS.space.lg,
      paddingTop: TOKENS.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.color.border.hairline,
    },
    doneRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: TOKENS.space.lg, gap: TOKENS.space.md },
    doneCheck: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: t.color.bg.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    doneFooter: { alignSelf: 'stretch', marginTop: TOKENS.space.md },
  });
