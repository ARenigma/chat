import React, { useCallback, useState } from 'react';
import {
  Image,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SCROLL_PHYSICS } from '../lib/scroll';
import Animated from 'react-native-reanimated';
import { topLevelIn } from '../theme/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { CLAY_SEEDS, CLAY_IMAGES, type ClaySeed } from '../lib/clayAvatars';
import {
  useSavePan,
  useSavePayoutAccount,
  useTaxProfile,
  usePayoutAccount,
  useCompleteProviderOnboarding,
  useSetClayAvatar,
  isDuplicateDisplayName,
  type PayoutMethod,
} from '../api/provider';
import { useImeSpace } from '../lib/useImeSpace';
import { useCheckDisplayName } from '../api/profileSetup';
import {
  CATEGORY_BADGE,
  DEFAULT_CATEGORY,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
} from '../lib/providerFilters';
import {
  STAGE_NAME_HINT,
  stageNamePii,
  stageNamePiiMessage,
  suggestStageName,
} from '../lib/stageName';
import { useStore } from '../store/useStore';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { NoticeBar } from '../components/NoticeBar';
import { TextField } from '../components/TextField';

interface Props {
  onBack: () => void;
  /** Kept for App.tsx; the real transition is the role flip → provider tree. */
  onSubmitted: () => void;
}

const LANGUAGES = ['English', 'Hindi', 'Tamil', 'Telugu', 'Bengali', 'Marathi'];

type Phase = 'verify' | 'checking' | 'confirm' | 'profile' | 'done';

/** Where one rung of the verification ladder has got to. */
type StepState = 'waiting' | 'running' | 'ok' | 'failed';

/** What the checks came back with, for the provider to confirm or reject. */
interface Fetched {
  /** The name registered against the PAN, from Income Tax Department records. */
  name: string | null;
  /** `YYYY-MM-DD`, as returned by the PAN check. */
  dob: string | null;
  /** The name the bank or PSP holds against the payout destination. */
  nameAtBank: string | null;
  /** Human-readable payout destination, already masked where it should be. */
  destination: string;
  /** False when the payout details are saved but Cashfree has not confirmed. */
  payoutConfirmed: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `YYYY-MM-DD` to "2 October 1996".
 *
 * Explicit rather than `toLocaleDateString`, which Hermes implements against
 * whatever ICU data the device ships: the same date renders differently across
 * Android versions, and this string is the one a provider checks their own
 * birth date against. Getting it silently wrong is worse than plain.
 */
function formatDob(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  const parts = iso.split('-');
  if (parts.length !== 3) {
    return null;
  }
  const month = MONTHS[Number(parts[1]) - 1];
  if (month === undefined) {
    return null;
  }
  return `${Number(parts[2])} ${month} ${parts[0]}`;
}

/**
 * All but the last four digits, replaced.
 *
 * The provider typed the number a moment ago, so this is not secrecy from them
 * — it is the shape everyone recognises as "your account", which is easier to
 * check at a glance than eighteen digits.
 */
function maskAccount(value: string): string {
  return value.length <= 4 ? value : `${'\u2022'.repeat(4)} ${value.slice(-4)}`;
}

/**
 * Five letters, four digits, a letter. Checked here only to enable the button —
 * the real verification is the Income Tax Department's, server-side.
 */
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * A UPI VPA, per NPCI's addressing spec: a handle, `@`, and a PSP suffix.
 *
 * Deliberately permissive on the handle (NPCI allows dots, hyphens and
 * underscores and does not cap it usefully) and strict on the shape, because
 * the only check that means anything is Cashfree's — this one exists to stop a
 * pointless round trip, not to decide validity.
 */
const VPA_SHAPE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/;

/** RBI's IFSC: four bank letters, a reserved `0`, six branch characters. */
const IFSC_SHAPE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers run 9–18 digits; no checksum is standardised. */
const ACCOUNT_SHAPE = /^[0-9]{9,18}$/;

/**
 * Becoming a provider, as ONE continuous flow (no second welcome/bloom).
 *
 * Reached straight after phone sign-in (App.tsx `pendingProviderApply`). The
 * order the product wants (Amit, 2026-09-03):
 *
 *   1. Verify — PAN **and** the payout destination, in ONE step and one submit
 *      (Amit, 2026-09-05: "take all inputs at once for all verification"). PAN
 *      360 Advanced returns the registered name and DOB — the DOB the
 *      auto-approve age gate reads — and that verified NAME is what opens the
 *      Cashfree Payouts beneficiary, so the payout account is checked against
 *      the PAN holder rather than against a name the provider typed.
 *
 *      Splitting these was the defect: the payout destination lived behind
 *      "Get paid" on the provider home, so a provider could finish onboarding,
 *      go live and earn before discovering there was nowhere to pay them.
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
  // Lifts the whole column — fields AND the footer button — clear of the IME.
  // See useImeSpace for why KeyboardAvoidingView could never do this on Android.
  const imeSpace = useImeSpace();
  const setNotice = useStore(s => s.setNotice);

  const [phase, setPhase] = useState<Phase>('verify');
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [about, setAbout] = useState('');
  const [avatarSeed, setAvatarSeed] = useState<ClaySeed | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  /** The suggestion currently in the field, so "untouched" can be told from "typed". */
  const [suggested, setSuggested] = useState<string | null>(null);
  /**
   * What they offer, which the directory groups by (migration 065). First,
   * because it frames every field under it — a stage name and a headline read
   * differently for an astrologer than for a listener.
   */
  const [category, setCategory] = useState<ProviderCategory>(DEFAULT_CATEGORY);

  const savePan = useSavePan();
  const savePayout = useSavePayoutAccount();
  // Only read AFTER the PAN check, for the verified name. `refetch` rather than
  // the cached value: the row is written by `verify-pan` server-side, so the
  // cache cannot know the name until it is asked again.
  const { refetch: refetchTax } = useTaxProfile();
  // Same reason as the tax profile: `name_at_bank` is written by
  // `verify-payout-account` server-side, so it has to be re-read.
  const { refetch: refetchPayout } = usePayoutAccount();
  const [pan, setPan] = useState('');
  const [panError, setPanError] = useState<string | null>(null);
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('upi');
  const [upiVpa, setUpiVpa] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [payoutNote, setPayoutNote] = useState<string | null>(null);
  // The ladder: one rung per external check, so the wait is legible instead of
  // a single spinner over a screen that might be doing anything.
  const [panStep, setPanStep] = useState<StepState>('waiting');
  const [payoutStep, setPayoutStep] = useState<StepState>('waiting');
  const [fetched, setFetched] = useState<Fetched | null>(null);
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
  /** Whether the payout half of the form is filled in well enough to send. */
  const payoutReady =
    payoutMethod === 'upi'
      ? VPA_SHAPE.test(upiVpa.trim())
      : ACCOUNT_SHAPE.test(accountNumber.trim()) && IFSC_SHAPE.test(ifsc.trim().toUpperCase());

  /**
   * ONE step: identity and payout destination, verified together.
   *
   * They used to be two places — PAN here, bank/UPI behind "Get paid" on the
   * provider home — and a provider could finish onboarding, go live, earn, and
   * only then discover there was nowhere to pay them. Taking both up front is
   * what Amit asked for (2026-09-05), and it is also the only order in which the
   * payout name can be CHECKED rather than typed:
   *
   *   1. PAN 360 Advanced returns the name registered against the PAN.
   *   2. That name — not one the provider types — is the beneficiary name sent
   *      to Cashfree Payouts, which then verifies it against the name on the
   *      account. So "the account belongs to the person whose PAN this is" is
   *      established by two independent parties, and a provider cannot route
   *      earnings to someone else's account by claiming their name.
   *
   * PAN therefore runs FIRST and a PAN failure stops the whole submit: without a
   * verified name there is nothing trustworthy to open a beneficiary with.
   */
  const onVerifyAndContinue = useCallback(() => {
    Keyboard.dismiss();
    setPanError(null);
    setPayoutError(null);
    setPayoutNote(null);
    setFetched(null);
    setPanStep('running');
    setPayoutStep('waiting');
    setPhase('checking');

    void (async () => {
      // ── Rung 1: the PAN ──────────────────────────────────────────────────
      let panStatus: 'verified' | 'failed' | 'pending';
      try {
        panStatus = await savePan.mutateAsync(pan);
      } catch {
        setPanStep('failed');
        setPanError('Something went wrong. Please try again.');
        return;
      }
      if (panStatus !== 'verified') {
        setPanStep('failed');
        // Only a real verification advances. A 'pending' or 'failed' PAN that
        // moved the user on would let them fill the whole profile and be
        // refused by `complete_provider_onboarding` at the very end, with no
        // way back to the step that failed.
        setPanError(
          panStatus === 'failed'
            ? 'That PAN could not be verified. Check the number and try again.'
            : 'We could not reach the verification service. Please try again.',
        );
        return;
      }
      const taxProfile = await refetchTax();
      const verifiedName = taxProfile.data?.pan_name ?? null;
      const verifiedDob = taxProfile.data?.verified_dob ?? null;
      setPanStep('ok');

      // ── Rung 2: the payout destination ───────────────────────────────────
      setPayoutStep('running');
      let payoutStatus;
      try {
        payoutStatus = await savePayout.mutateAsync({
          method: payoutMethod,
          upiVpa: payoutMethod === 'upi' ? upiVpa.trim() : undefined,
          accountNumber: payoutMethod === 'bank' ? accountNumber.trim() : undefined,
          ifsc: payoutMethod === 'bank' ? ifsc.trim().toUpperCase() : undefined,
          // The name from the PAN check, never one the provider typed: that is
          // what makes "this account belongs to the PAN holder" a fact checked
          // by two independent parties rather than a claim.
          accountHolderName: verifiedName ?? undefined,
        });
      } catch {
        setPayoutStep('failed');
        setPayoutError('We could not save that. Check the details and try again.');
        return;
      }
      if (payoutStatus === 'failed') {
        setPayoutStep('failed');
        setPayoutError(
          payoutMethod === 'upi'
            ? 'That UPI ID could not be verified. Check it and try again.'
            : 'That account could not be verified. Check the number and IFSC.',
        );
        return;
      }
      const payoutRow = await refetchPayout();
      setPayoutStep('ok');

      // 'pending' means the DETAILS ARE SAVED but Cashfree Payouts has not
      // confirmed them, which is the normal state while payouts are switched
      // off in appConfig. ADR-0022's listing gate
      // (`payout_readiness.can_go_live`) is what holds an unconfirmed account
      // back from earning, so carrying on here loses nothing and stopping here
      // would lose the whole signup for a reason that is ours, not theirs.
      const confirmed = payoutStatus === 'verified';
      if (!confirmed) {
        setPayoutNote(
          'Saved. We are still confirming this with your bank, so carry on setting up.',
        );
      }

      setFetched({
        name: verifiedName,
        dob: verifiedDob,
        nameAtBank: payoutRow.data?.name_at_bank ?? null,
        destination:
          payoutMethod === 'upi'
            ? upiVpa.trim()
            : `${maskAccount(accountNumber.trim())} \u00b7 ${ifsc.trim().toUpperCase()}`,
        payoutConfirmed: confirmed,
      });
      // NOT straight to the profile. Everything above came from a third party
      // about this person, and a wrong name or birth date has to be catchable
      // before it becomes their account (Amit, 2026-09-05).
      setPhase('confirm');
    })();
  }, [
    pan,
    savePan,
    savePayout,
    refetchTax,
    refetchPayout,
    payoutMethod,
    upiVpa,
    accountNumber,
    ifsc,
  ]);

  /** Back to the form with the ladder reset, from a failed rung or a rejection. */
  const onEditDetails = useCallback(() => {
    setPanStep('waiting');
    setPayoutStep('waiting');
    setFetched(null);
    setPhase('verify');
  }, []);

  // The stage name, checked while they type rather than only when Go live
  // fails: the same `check_display_name` the member flow uses (3–24 chars,
  // [A-Za-z0-9_], unique), plus a local look at whether the name is THEM.
  // `fetched.name` is the PAN-verified name from the confirm step.
  const { data: nameCheck, isFetching: checkingName } = useCheckDisplayName(
    displayName,
    phase === 'profile',
  );
  const namePii = stageNamePii(displayName, fetched?.name ?? null);
  const nameTaken = nameCheck?.status === 'taken' || nameCheck?.status === 'invalid';

  // The field opens filled (stageName.ts). Only on the way in, and only if they
  // have not typed one already — coming back via "Something is wrong" must not
  // overwrite their work.
  const enterProfile = useCallback(() => {
    if (displayName.trim() === '') {
      const first = suggestStageName();
      setSuggested(first);
      setDisplayName(first);
    }
    setPhase('profile');
  }, [displayName]);

  const rerollName = useCallback(() => {
    const next = suggestStageName();
    setSuggested(next);
    setDisplayName(next);
    setNameError(null);
  }, []);

  const profileReady =
    displayName.trim().length > 0 &&
    // A phone number in the name is blocked outright; a real-name match is a
    // heuristic and only warns (stageName.ts). Taken/invalid is the server's
    // word and would fail at Go live anyway — better to hold the button.
    namePii !== 'phone' &&
    !nameTaken &&
    headline.trim().length > 0 &&
    languages.length > 0 &&
    about.trim().length > 0;

  const onGoLive = useCallback(() => {
    Keyboard.dismiss();
    setNameError(null);
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
          category,
        });
        setPhase('done');
      } catch (err) {
        /*
         * The notice is not enough on its own for this one.
         *
         * A taken stage name is a problem with ONE field, and the fix is to
         * change that field, so it is said next to it rather than only in a bar
         * that fades after four seconds. Found on the Redmi 2026-09-05: "Go live"
         * appeared to do nothing at all, because the RPC failed on
         * `profiles_display_name_lower_unique` and every route to telling the
         * user was either absent or unactionable.
         */
        if (isDuplicateDisplayName((err as Error)?.message ?? '')) {
          setNameError('That name is already taken. Pick another one.');
        }
        // Everything else is surfaced by useCompleteProviderOnboarding's notice.
      }
    })();
  }, [avatarSeed, setClay, complete, displayName, headline, languages, about, category]);

  // ── Phase: verify — identity AND payout, in one pass ────────────────────
  if (phase === 'verify') {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: imeSpace }]}>
        <Header onBack={onBack} />
        {/* A ScrollView, not a centred block: with the IME up this step is
            taller than the remaining window on a 1080x2340 device, and the
            root's `imeSpace` padding shrinks it further. */}
        <ScrollView
          {...SCROLL_PHYSICS}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.verifyIcon}>
            <Icon name="wallet" size={30} color={theme.color.text.onAccent} />
          </View>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
            allowFontScaling
            style={styles.title}>
            Verify it&apos;s you, and where to pay you
          </Text>
          <Text allowFontScaling style={styles.verifyBodyText}>
            Both at once, so nothing is left half-done. Your PAN confirms who you
            are and your age, and it is what lets us pay you without deducting 5%
            TDS. We keep only the result.
          </Text>

          <Field label="PAN">
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
              style={styles.input}
            />
            {panError !== null ? (
              <Text allowFontScaling style={styles.verifyError}>
                {panError}
              </Text>
            ) : null}
          </Field>

          <Text allowFontScaling style={styles.verifyBodyText}>
            Where your earnings go. The name on it has to match the name on your
            PAN, and we send that name for you, so there is nothing to type.
          </Text>

          {/* UPI first, and the default: it needs one field instead of two and
              it is how most people in India already receive money. A bank
              account stays available because a UPI ID is not universal. */}
          <View style={styles.methodRow}>
            <Chip
              label="UPI ID"
              selected={payoutMethod === 'upi'}
              onPress={() => {
                setPayoutMethod('upi');
                setPayoutError(null);
              }}
            />
            <Chip
              label="Bank account"
              selected={payoutMethod === 'bank'}
              onPress={() => {
                setPayoutMethod('bank');
                setPayoutError(null);
              }}
            />
          </View>

          {payoutMethod === 'upi' ? (
            <Field label="UPI ID">
              <TextField
                value={upiVpa}
                onChangeText={setUpiVpa}
                placeholder="yourname@bank"
                placeholderTextColor={theme.color.text.tertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                allowFontScaling
                accessibilityLabel="UPI ID"
                testID="provider-upi"
                style={styles.input}
              />
            </Field>
          ) : (
            <>
              <Field label="Account number">
                <TextField
                  value={accountNumber}
                  onChangeText={t => setAccountNumber(t.replace(/[^0-9]/g, '').slice(0, 18))}
                  placeholder="9 to 18 digits"
                  placeholderTextColor={theme.color.text.tertiary}
                  keyboardType="number-pad"
                  maxLength={18}
                  allowFontScaling
                  accessibilityLabel="Bank account number"
                  testID="provider-account-number"
                  style={styles.input}
                />
              </Field>
              <Field label="IFSC">
                <TextField
                  value={ifsc}
                  onChangeText={t => setIfsc(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                  placeholder="HDFC0001234"
                  placeholderTextColor={theme.color.text.tertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={11}
                  allowFontScaling
                  accessibilityLabel="IFSC code"
                  testID="provider-ifsc"
                  style={styles.input}
                />
              </Field>
            </>
          )}

          {payoutError !== null ? (
            <Text allowFontScaling style={styles.verifyError} testID="payout-error">
              {payoutError}
            </Text>
          ) : null}
          {payoutNote !== null ? (
            <Text allowFontScaling style={styles.verifyHint} testID="payout-note">
              {payoutNote}
            </Text>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: (imeSpace > 0 ? 0 : insets.bottom) + TOKENS.space.md }]}>
          <Button
            label="Verify and continue"
            onPress={onVerifyAndContinue}
            disabled={!PAN_SHAPE.test(pan) || !payoutReady}
            busy={savePan.isPending || savePayout.isPending}
            busyLabel="Verifying"
            testID="provider-verify"
          />
        </View>
      </View>
    );
  }

  // ── Phase: checking — the ladder, one rung per external check ───────────
  if (phase === 'checking') {
    const failed = panStep === 'failed' || payoutStep === 'failed';
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header onBack={onEditDetails} />
        <View style={styles.ladderBody}>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
            allowFontScaling
            style={styles.title}>
            {failed ? 'That did not go through' : 'Checking your details'}
          </Text>
          <View style={styles.ladder}>
            <LadderStep
              state={panStep}
              label="Confirming your PAN with the Income Tax Department"
              error={panError}
              testID="ladder-pan"
            />
            <LadderStep
              state={payoutStep}
              label={
                payoutMethod === 'upi'
                  ? 'Confirming your UPI ID with your bank'
                  : 'Confirming your account with your bank'
              }
              error={payoutError}
              testID="ladder-payout"
            />
          </View>
        </View>
        {failed ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.md }]}>
            <Button
              label="Change my details"
              onPress={onEditDetails}
              testID="provider-check-retry"
            />
          </View>
        ) : null}
      </View>
    );
  }

  // ── Phase: confirm — show what came back, advance only on acceptance ─────
  if (phase === 'confirm' && fetched !== null) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header onBack={onEditDetails} />
        <ScrollView
          {...SCROLL_PHYSICS}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}>
          <View style={styles.verifyIcon}>
            <Icon name="check" size={30} color={theme.color.text.onAccent} />
          </View>
          <Text
            maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
            allowFontScaling
            style={styles.title}>
            Is this you?
          </Text>
          <Text allowFontScaling style={styles.verifyBodyText}>
            This is what came back from the checks. Nothing here was typed by
            you, so read it before you accept it.
          </Text>

          <View style={styles.confirmCard} testID="confirm-details">
            <ConfirmRow label="Name" value={fetched.name} testID="confirm-name" />
            <ConfirmRow
              label="Date of birth"
              value={formatDob(fetched.dob)}
              testID="confirm-dob"
            />
            <ConfirmRow label="PAN" value={pan} testID="confirm-pan" />
            <ConfirmRow
              label={payoutMethod === 'upi' ? 'UPI ID' : 'Bank account'}
              value={fetched.destination}
              testID="confirm-destination"
            />
            {/* Only when the bank actually told us a name. Printing the PAN
                name here instead would show our own input back as if it were
                their confirmation, which is exactly the check being made. */}
            {fetched.nameAtBank !== null ? (
              <ConfirmRow
                label="Name on the account"
                value={fetched.nameAtBank}
                testID="confirm-name-at-bank"
              />
            ) : null}
          </View>

          {!fetched.payoutConfirmed && payoutNote !== null ? (
            <Text allowFontScaling style={styles.verifyHint} testID="payout-note">
              {payoutNote}
            </Text>
          ) : null}
          <Text allowFontScaling style={styles.verifyHint}>
            Your date of birth is used for the 18+ check and is never shown to
            members.
          </Text>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + TOKENS.space.md }]}>
          <Button
            label="Yes, this is me"
            onPress={enterProfile}
            testID="provider-confirm-details"
          />
          <Pressable
            onPress={onEditDetails}
            accessibilityLabel="Something is wrong, change my details"
            press="button"
            style={styles.confirmReject}>
            <Text allowFontScaling style={styles.confirmRejectLabel}>
              Something is wrong
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Phase: done ──────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <Animated.View
        entering={topLevelIn}
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
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: imeSpace }]}>
      <Header onBack={() => setPhase('verify')} />
      {/*
        * NoticeBar was mounted in ChatScreen and NOWHERE ELSE, so every
        * `setNotice` from this flow - the 18+ refusal and "verify your identity
        * first" included - was written to the store and never shown. That is why
        * "Go live" looked like a dead button: the RPC failed and the app had no
        * surface on which to say so.
        */}
      <NoticeBar />
      <ScrollView
        {...SCROLL_PHYSICS}
        contentContainerStyle={[styles.scroll, { paddingBottom: (imeSpace > 0 ? 0 : insets.bottom) + TOKENS.space.md }]}
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

        <Field label="What you offer">
          <View style={styles.chips} testID="provider-category">
            {PROVIDER_CATEGORIES.map(c => (
              <Chip
                key={c}
                label={CATEGORY_BADGE[c]}
                tone={category === c ? 'warm' : 'neutral'}
                selected={category === c}
                onPress={() => setCategory(c)}
              />
            ))}
          </View>
          <Text allowFontScaling style={styles.verifyHint}>
            Members browse Listeners and Astrologers separately. Same rates either way.
          </Text>
        </Field>

        <Field label="Stage name">
          <TextField
            testID="provider-name"
            style={styles.input}
            value={displayName}
            onChangeText={t => {
              setDisplayName(t);
              // Cleared as soon as they act on it; leaving it up while they type
              // reads as the NEW name being rejected too.
              setNameError(null);
            }}
            placeholder="The name members will see"
            placeholderTextColor={theme.color.text.tertiary}
            maxLength={40}
            allowFontScaling
            underlineColorAndroid="transparent"
          />
          <View style={styles.nameRow}>
            <Pressable
              onPress={rerollName}
              testID="provider-name-reroll"
              accessibilityLabel="Suggest another stage name"
              press="chip"
              style={styles.nameReroll}>
              <Text allowFontScaling style={styles.nameRerollLabel}>
                Try another
              </Text>
            </Pressable>
            {/* One line, one voice, in priority order: the hard error from Go
                live, a PII hit, the live availability check, then the standing
                hint while the suggestion is untouched. */}
            {nameError !== null ? (
              <Text allowFontScaling style={[styles.nameStatus, styles.verifyError]} testID="provider-name-error">
                {nameError}
              </Text>
            ) : namePii !== null ? (
              <Text
                allowFontScaling
                style={[styles.nameStatus, styles.verifyError]}
                testID="provider-name-pii-warning">
                {stageNamePiiMessage(namePii)}
              </Text>
            ) : nameTaken ? (
              <Text allowFontScaling style={[styles.nameStatus, styles.verifyError]} testID="provider-name-taken">
                {nameCheck?.status === 'taken' ? 'Already taken. Try another.' : nameCheck?.message}
              </Text>
            ) : checkingName ? (
              <Text allowFontScaling style={[styles.nameStatus, styles.verifyHint]}>
                Checking…
              </Text>
            ) : displayName.trim() !== '' && displayName === suggested ? (
              <Text allowFontScaling style={[styles.nameStatus, styles.verifyHint]}>
                {STAGE_NAME_HINT}
              </Text>
            ) : nameCheck?.status === 'available' ? (
              <Text
                allowFontScaling
                style={[styles.nameStatus, styles.namePositive]}
                testID="provider-name-available">
                Available
              </Text>
            ) : null}
          </View>
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
                  highlight="dim"
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

      <View style={[styles.footer, { paddingBottom: (imeSpace > 0 ? 0 : insets.bottom) + TOKENS.space.md }]}>
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
    </View>
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
        highlight="dim"
        // `back` sets no radius, so the `dim` fill painted a solid 28x40
        // rectangle behind the chevron. Icon-only controls take borderless
        // (circular) ink, not the bounded rectangular kind. The box is oblong, so
        // the pill resolves to a 28-wide stadium rather than a true circle —
        // intended for an oblong icon slot, stated per rule 1.6.
        // https://developer.android.com/training/material/animations
        shape="circle"
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

/**
 * One rung of the verification ladder.
 *
 * A rung per external call, rather than one spinner over the whole screen. Two
 * different parties are being asked two different questions, they take
 * different amounts of time, and when one fails the provider needs to know
 * WHICH one — a single "Verifying..." cannot say any of that.
 */
function LadderStep({
  state,
  label,
  error,
  testID,
}: {
  state: StepState;
  label: string;
  error: string | null;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <View style={styles.ladderRow} testID={testID}>
      <View style={styles.ladderMark}>
        {state === 'running' ? (
          <LoadingIndicator size={22} />
        ) : state === 'ok' ? (
          <Icon name="check" size={20} color={theme.color.text.positive} />
        ) : state === 'failed' ? (
          <Icon name="close" size={20} color={theme.color.text.accent} />
        ) : (
          // A waiting rung is drawn, not hidden: the ladder should show how
          // many checks there are from the first frame, so a second one
          // appearing does not read as something having gone wrong.
          <View style={styles.ladderPending} />
        )}
      </View>
      <View style={styles.ladderText}>
        <Text
          allowFontScaling
          style={[
            styles.ladderLabel,
            state === 'waiting' ? styles.ladderLabelWaiting : null,
          ]}>
          {label}
        </Text>
        {state === 'failed' && error !== null ? (
          <Text allowFontScaling style={styles.verifyError}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** One fetched fact, label above value, for the confirmation card. */
function ConfirmRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string | null;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.confirmRow}>
      <Text allowFontScaling style={styles.confirmLabel}>
        {label}
      </Text>
      <Text allowFontScaling style={styles.confirmValue} testID={testID}>
        {/* An absent value is named rather than left blank: an empty row reads
            as a rendering bug, and "not provided" is a fact worth showing. */}
        {value ?? 'Not provided'}
      </Text>
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
    /* A failure has to read as one. The neutral hint colour was being used for
       both "here is how this works" and "that PAN is wrong", which made the
       error the calmest text on the screen. */
    verifyError: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.accent,
    },
    methodRow: { flexDirection: 'row', gap: TOKENS.space.xs },
    /*
     * Same box as `verifyBody`, plus an EXPLICIT backgroundColor, and the
     * background is the thing that matters rather than a style tidy-up.
     *
     * With no background this container carries only layout props, so RN's view
     * flattening removes it and hoists its children into the screen root — and
     * in that position a plain `Text` lays out at correct bounds and paints
     * nothing. Verified on the Redmi 2026-09-05: the ladder measured 970x132
     * per rung with every pixel inside those bounds #FFFFFF, while the same
     * string inside a background-carrying View painted normally. The colour is
     * `bg.base`, which is what was showing through anyway, so this is invisible
     * to the eye and load-bearing to the renderer.
     *
     * It also explains why the verify and confirm steps never showed this bug
     * while this one did: both open with `verifyIcon`, which carries
     * `bg.accent`, so their subtree always had a background-bearing view in it.
     * The ladder had none.
     *
     * Do not "simplify" this back to `verifyBody`. `collapsable={false}`, a
     * ScrollView, per-phase remount keys, `Animated.Text`, and disabling the
     * hardware blur were each tried on a cold launch and none of them fixed it.
     */
    ladderBody: {
      flex: 1,
      paddingHorizontal: TOKENS.space.lg,
      justifyContent: 'center',
      gap: TOKENS.space.md,
      backgroundColor: t.color.bg.base,
    },
    ladder: { gap: TOKENS.space.md, marginTop: TOKENS.space.lg },
    ladderRow: { flexDirection: 'row', gap: TOKENS.space.sm, alignItems: 'flex-start' },
    ladderMark: { width: 24, height: 26, alignItems: 'center', justifyContent: 'center' },
    ladderPending: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: t.color.border.hairline,
    },
    ladderText: { flex: 1, gap: TOKENS.space['2xs'] },
    ladderLabel: { ...TOKENS.typography.bodyLarge, color: t.color.text.primary },
    ladderLabelWaiting: { color: t.color.text.tertiary },
    confirmCard: {
      borderRadius: TOKENS.radius.field,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      gap: TOKENS.space.md,
    },
    confirmRow: { gap: TOKENS.space.hair },
    confirmLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.secondary },
    confirmValue: { ...TOKENS.typography.bodyLarge, color: t.color.text.primary },
    confirmReject: {
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: TOKENS.space['2xs'],
    },
    confirmRejectLabel: { ...TOKENS.typography.bodyLarge, color: t.color.text.secondary },
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
    // Reroll chip on the left, the one status line filling the rest.
    nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: TOKENS.space.sm },
    nameReroll: {
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentTint,
    },
    nameRerollLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.accent },
    nameStatus: { flex: 1, paddingTop: TOKENS.space['2xs'] },
    namePositive: { ...TOKENS.typography.bodyMedium, color: t.color.text.positive },
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
