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
import { USERNAME_MAX } from '../lib/username';
import { USERNAME_SUGGESTION_HINT, suggestUsernames } from '../lib/stageName';
import { CLAY_SEEDS, CLAY_IMAGES, type ClaySeed } from '../lib/clayAvatars';
import { useAcceptAllPendingPolicies, usePendingPolicies } from '../api/policy';
import {
  AGE_BRACKETS,
  setMemberAgeBracket,
  setPreferredLanguages,
  useClaimMemberProfile,
  useUsernameVerdict,
  type AgeBracket,
} from '../api/profileSetup';
import {
  OFFERED_LANGUAGES,
  isLanguageSelected,
  toggleLanguage,
} from '../lib/languagePrefs';
import { Button } from '../components/Button';
import { FilterChip } from '../components/Chip';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { M3Field } from '../components/TextField';
import { LoadingIndicator } from '../components/LoadingIndicator';

/**
 * The terms checkbox's corner radius, shared by the visible box and the
 * Pressable's state-layer clip.
 *
 * One constant rather than the literal twice, because the two MUST agree: the
 * state layer is clipped by the Pressable's inner view, so if the hit box's
 * radius is smaller than the visible box's, the `dim` fill — which is a full
 * opacity fill, not a 10% tint — shows as four square nubs poking out past the
 * checkbox's rounded corners. With the literal in two places that is a silent
 * break the next time either number is touched.
 *
 * NOT `shape="circle"`: a checkbox is a rounded square and its state layer
 * follows the container's shape, which for a checkbox is a small corner radius,
 * never a pill. The circle belongs to the icon button.
 * https://developer.android.com/develop/ui/views/components/checkbox
 */
const CHECKBOX_RADIUS = 6;

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
  /**
   * Show the language-preference step (migration 072).
   *
   * This screen is the browser-redirect path's equivalent of the question
   * `OnboardingScreen` asks inline, and it exists so the two sign-in routes
   * differ in WHERE the member is asked and never in WHETHER. The browser
   * returns through `handleAuthDeepLink`, which unmounts the inline flow before
   * its language step can run — so without this the browser was a way around
   * the question.
   *
   * Independent of the other two flags: a member who already has a name and a
   * bracket can still owe an answer here, and does if they signed up before 072.
   */
  needsLanguages?: boolean;
}

export function ProfileSetupScreen({
  onDone,
  needsAge = false,
  needsUsername = true,
  needsLanguages = false,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const setNotice = useStore(s => s.setNotice);

  /*
   * The steps this run owes, in order, derived from the flags rather than
   * branched at each hand-off.
   *
   * It used to be a two-valued `useState` plus an `if (needsUsername)` inside
   * the age handler. Adding a third step to that shape means every handler has
   * to know about every other step's flag, and the number of branches grows
   * with the square of the steps — which is how the language question came to
   * be askable on one sign-in path and not the other in the first place. One
   * ordered list and one `advance()` means a step only has to know that it is
   * finished.
   *
   * Order: age, then languages, then the username form. The same order the
   * inline flow uses (`visibleSteps` in `lib/onboarding.ts`), and for its stated
   * reason — age is the gate the app cannot start without, so it is asked first,
   * and the identity form is the longest, so it is last.
   */
  const steps = useMemo(() => {
    const ordered: ('age' | 'languages' | 'profile')[] = [];
    if (needsAge) {
      ordered.push('age');
    }
    if (needsLanguages) {
      ordered.push('languages');
    }
    if (needsUsername) {
      ordered.push('profile');
    }
    /*
     * A caller that asks for nothing still gets the username form, which is
     * this screen's historical default (`needsUsername = true`). Returning an
     * empty list would render a blank screen with no way off it — the boot gate
     * only routes here when at least one flag is set, but a screen that depends
     * on its caller for that is one refactor away from being stuck.
     */
    return ordered.length > 0 ? ordered : (['profile'] as const);
  }, [needsAge, needsLanguages, needsUsername]);

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex] ?? 'profile';

  /** Move to the next owed step, or leave if this was the last one. */
  const advance = useCallback(() => {
    setStepIndex(i => {
      if (i + 1 >= steps.length) {
        onDone();
        return i;
      }
      return i + 1;
    });
  }, [steps.length, onDone]);

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
        advance();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Could not save. Please try again.');
      } finally {
        setBracketSaving(false);
      }
    },
    [bracketSaving, advance, setNotice],
  );

  const [languages, setLanguages] = useState<string[]>([]);
  const [languagesSaving, setLanguagesSaving] = useState(false);

  const onToggleLanguage = useCallback((language: string) => {
    setLanguages(current => toggleLanguage(current, language));
  }, []);

  /**
   * Confirm the language preference, or deliberately skip it.
   *
   * Mirrors `onSubmitLanguages` in `OnboardingScreen` deliberately, including
   * the part that looks like a bug: a failed write does NOT hold the member
   * here. The preference only reorders a list, so stranding someone on a chip
   * row over it would be the worst trade available for the least important
   * thing this screen collects. It is retryable, and the boot gate will ask
   * again on the next cold start because the column is still empty.
   *
   * No auto-advance on the first tap, unlike the age chips above: this is a
   * multi-select, so the first tap is the beginning of the answer rather than
   * the answer, and submitting on it would make a second language unreachable.
   */
  const onSubmitLanguages = useCallback(() => {
    if (languagesSaving) {
      return;
    }
    setLanguagesSaving(true);
    void (async () => {
      try {
        await setPreferredLanguages(languages);
      } catch {
        // Swallowed on purpose, and not surfaced: see the note above. There is
        // nothing the member could do about it and nothing they lose.
      }
      setLanguagesSaving(false);
      advance();
    })();
  }, [languagesSaving, languages, advance]);

  /**
   * Three handles to tap, a re-roll, and the first of them already in the
   * field.
   *
   * This is a reversal, and the note it replaces argued the other way: the
   * field used to open EMPTY, on the reasoning that "claiming is the point" and
   * a member's own idea should get the first move. Amit, 2026-09-17: the
   * suggestion goes in the field and stays editable. A blank required field is
   * a creative task at the end of a form on both sides of this app, and the
   * provider screen already opens filled for exactly that reason; a member who
   * has their own idea types over it, which costs them one gesture, while a
   * member who does not now has a complete, free, checked name without one.
   *
   * Lazy initial state, not `useState(suggestUsernames())`: the argument form
   * re-runs the generator on every render and throws the result away, so the
   * chips would be recomputed behind an unchanging set of labels.
   */
  const [suggestions, setSuggestions] = useState<string[]>(() =>
    suggestUsernames(),
  );
  const [displayName, setDisplayName] = useState(() => suggestions[0] ?? '');
  /**
   * The last name THIS SCREEN put in the field, which is what makes re-roll
   * safe to point at the field at all: a control labelled "Try another" may
   * replace our own suggestion, and may not delete something the member typed.
   */
  const [offered, setOffered] = useState(() => displayName);
  const [avatarSeed, setAvatarSeed] = useState<ClaySeed | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  /**
   * Whether Continue has been refused for the unticked box.
   *
   * The checkbox is the thing that is wrong, so the checkbox is where the cue
   * belongs. NoticeBar below covers the generic failures, but a transient strip
   * at the top of a screen is a weak answer to "tick this box down here" — and
   * on a short screen the member is already looking at the button, not the top.
   */
  const [termsRefused, setTermsRefused] = useState(false);

  const { verdict, retry: retryNameCheck } = useUsernameVerdict(displayName);

  const claim = useClaimMemberProfile();
  const { data: pending = [] } = usePendingPolicies();
  const acceptAll = useAcceptAllPendingPolicies();

  /**
   * One line under the field, and every branch of it says something TRUE.
   *
   * `check_failed` is the branch worth reading. It is the network, not the
   * name, and it gets its own words and its own colour (accent, tappable)
   * rather than the danger red the taken branch wears — a member told "already
   * taken" about a name that is free abandons it, and the mistake is invisible
   * because both look like a verdict.
   *
   * No motion on the swap. The animate-expo gate puts a keystroke-driven
   * element in the "tens of times a day" tier, where the budget is under 150ms
   * or nothing, and a message whose whole job is to be read the instant it is
   * true has nothing to gain from a fade in front of it.
   */
  const statusLine = useMemo(() => {
    switch (verdict) {
      case 'idle':
        return null;
      case 'too_short':
        return { text: 'At least 3 characters', tone: 'bad' as const };
      case 'invalid_chars':
        return {
          text: 'Letters, numbers, and underscores only',
          tone: 'bad' as const,
        };
      case 'too_long':
        return {
          text: `Up to ${USERNAME_MAX} characters`,
          tone: 'bad' as const,
        };
      case 'checking':
        return { text: 'Checking…', tone: 'muted' as const };
      case 'available':
        return { text: 'Yay! great choice', tone: 'good' as const };
      case 'taken':
        return { text: 'Oops! already taken', tone: 'bad' as const };
      case 'check_failed':
        return {
          text: "Couldn't check that name right now.",
          tone: 'retry' as const,
        };
    }
  }, [verdict]);

  const chooseSuggestion = useCallback((name: string) => {
    setDisplayName(name);
    setOffered(name);
  }, []);

  // Re-roll moves the field only when the field still holds the name we put
  // there. Typed text survives it, which is the whole reason `offered` is
  // tracked rather than comparing against the current chip row.
  const rerollSuggestions = useCallback(() => {
    const fresh = suggestUsernames();
    setSuggestions(fresh);
    const next = fresh[0];
    if (next !== undefined && displayName.trim() === offered) {
      setDisplayName(next);
      setOffered(next);
    }
  }, [displayName, offered]);

  /**
   * The suggestion the member has in the field that came back bad.
   *
   * Availability is reported on TAP rather than before the chips are offered.
   * `useCheckDisplayName` is one debounced query over one name — pre-checking
   * three would mean three hook instances firing three RPCs on every re-roll,
   * a second mechanism beside the one the field already uses, and two sources
   * that can disagree about the same name. Tapping fills the field, the live
   * check runs exactly as it does for a typed name, and the chip is marked from
   * THE SAME derived value as the status line under the field — so the two
   * cannot say different things about one name.
   *
   * `verdict === 'taken'` exactly, and not "anything that is not available":
   * the strikethrough claims somebody else holds the name, which a failed
   * check has not established.
   */
  const rejectedName = verdict === 'taken' ? displayName.trim() : null;

  /**
   * The field's own label carries the verdict, because the verdict line is a
   * separate node: TalkBack reads the edit field on focus and the live region
   * when it changes, and a member who arrives at the field after the change has
   * already been announced would otherwise hear an unqualified "Username".
   */
  const nameStateLabel = useMemo(() => {
    switch (verdict) {
      case 'idle':
        return 'no name yet';
      case 'too_short':
        return 'too short, at least 3 characters';
      case 'invalid_chars':
        return 'letters, numbers and underscores only';
      case 'too_long':
        return `too long, up to ${USERNAME_MAX} characters`;
      case 'checking':
        return 'checking availability';
      case 'available':
        return 'available';
      case 'taken':
        return 'already taken';
      case 'check_failed':
        return 'could not be checked right now';
    }
  }, [verdict]);

  const nameReady = verdict === 'available';
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
      setTermsRefused(true);
      setNotice('Please accept the terms & conditions to continue.');
      return;
    }
    try {
      await claim.mutateAsync({ displayName, avatarSeed });
      const ids = pending.map(p => p.id);
      if (ids.length > 0) {
        await acceptAll.mutateAsync(ids);
      }
      // `advance()`, not `onDone()`: the username form is last in every
      // ordering this screen builds, so the two are the same call today, and
      // routing it through the one hand-off means a step added after this one
      // does not silently skip.
      advance();
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
    advance,
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

  if (step === 'languages') {
    /*
     * The language preference: Material 3 FILTER chips, then one control that
     * both confirms and skips.
     *
     * Same copy and the same control as the inline flow's language step, on
     * purpose — this is the SAME question asked on the other sign-in route, and
     * a member who saw one and then the other should not be able to tell that
     * two screens were involved. `OFFERED_LANGUAGES` and `FilterChip` are shared
     * rather than restated, which is what makes that true by construction
     * instead of by proofreading.
     *
     * Filter chips because M3 names them for choosing several things out of a
     * set. Note the contrast with the age row directly above, which is four
     * `Pressable` pills with `accessibilityRole="radio"`: that step is a single
     * choice and auto-advances on the first tap. This one is a multi-select, so
     * it carries leading checks and waits for a deliberate confirm — the first
     * tap here is the beginning of the answer, not the answer.
     *
     * No KeyboardAvoidingView and no ScrollView, matching the age step: six
     * chips and a button always fit, and there is no text input.
     */
    return (
      <View
        style={[
          styles.root,
          styles.agePage,
          { paddingTop: insets.top, paddingBottom: insets.bottom + 24 },
        ]}>
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized}
          allowFontScaling
          style={styles.title}>
          Which languages?
        </Text>
        <Text allowFontScaling style={styles.subtitle}>
          Pick any you&apos;re comfortable in. We&apos;ll put them first.
        </Text>

        <View style={styles.languageChips}>
          {OFFERED_LANGUAGES.map(language => (
            <FilterChip
              key={language}
              label={language}
              selected={isLanguageSelected(languages, language)}
              onToggle={onToggleLanguage}
              disabled={languagesSaving}
              testID={`profile-language-chip-${language}`}
            />
          ))}
        </View>

        {/*
         * ONE control, whose label carries the skip.
         *
         * A separate "Skip" link beside Continue asks the member to classify
         * their own inaction and puts a second target under a row they may still
         * be tapping. With nothing selected the label says so and does the same
         * thing, because the empty selection has defined behaviour all the way
         * down: `sortByLanguageMatch` returns the directory in the order it
         * already had. So there is genuinely one action here, not two.
         *
         * Never `disabled`, unlike the username form's Continue: skipping is a
         * real answer, so this control is live from the first frame. Dimming it
         * would say the step cannot be left, which is the opposite of true.
         */}
        <Button
          label={languages.length === 0 ? 'Skip for now' : 'Continue'}
          onPress={onSubmitLanguages}
          busy={languagesSaving}
          busyLabel="Saving"
          testID="profile-language-continue"
        />
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

        {/* This screen had the third of three different field conventions — a
            titleMediumEmphasized label in text.primary over a bg.sunken box with
            a hairline border, against labelMedium/secondary over bg.base with a
            1dp border on the provider screens. That spread is what Amit was
            pointing at, so the label is M3Field's `Above` label now and reads at
            labelMedium like every other field in the app. The hero copy above
            ("Claim your username") still carries the screen. */}
        <M3Field
          label="Username"
          containerStyle={styles.field}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="username"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={USERNAME_MAX}
          accessibilityLabel={`Username, ${nameStateLabel}`}
          testID="profile-setup-username"
        />
        {/* NOT moved into M3Field's supporting-text slot, deliberately. This is a
            live availability readout with three tones, and the slot is bodySmall
            with one error colour — folding it in would flatten "taken" and
            "available" into the same grey. It stays a sibling at bodyLarge. */}
        {statusLine ? (
          <View style={styles.statusRow}>
            <Text
              allowFontScaling
              // The verdict changes while the member's focus is in the field,
              // so nothing moves a screen reader to this node on its own.
              // `polite` queues the announcement behind whatever the keyboard
              // is saying rather than cutting it off, which `assertive` would
              // do on every keystroke that lands a new verdict.
              accessibilityLiveRegion="polite"
              testID="profile-setup-username-status"
              style={[
                styles.status,
                statusLine.tone === 'good'
                  ? styles.statusGood
                  : statusLine.tone === 'bad'
                    ? styles.statusBad
                    : statusLine.tone === 'retry'
                      ? styles.statusRetry
                      : styles.statusMuted,
              ]}>
              {statusLine.text}
            </Text>
            {statusLine.tone === 'retry' ? (
              <Pressable
                onPress={retryNameCheck}
                press="chip"
                accessibilityRole="button"
                accessibilityLabel="Check this username again"
                testID="profile-setup-username-retry"
                style={styles.statusRetryHit}>
                <Text allowFontScaling style={styles.statusRetryLabel}>
                  Try again
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/*
          * Suggestions. One row that wraps, with the re-roll last so it reads as
          * "…or try another three" rather than as a fourth name.
          *
          * The chips are local Pressables rather than `Chip`/`FilterChip`: Chip
          * hard-codes `Start with: ${label}` as its accessibility label and a
          * `starter-*` testID (it is the conversation opener), and FilterChip is
          * M3's multi-select control, which these are not — tapping one REPLACES
          * the field's contents. The re-roll's own pill is the provider screen's
          * `nameReroll`, token for token, because it is the same control.
          */}
        <Text allowFontScaling style={styles.suggestHint}>
          {USERNAME_SUGGESTION_HINT}
        </Text>
        <View style={styles.suggestRow}>
          {suggestions.map((name, i) => {
            const chosen = name === displayName.trim();
            const taken = name === rejectedName;
            return (
              <Pressable
                key={name}
                onPress={() => chooseSuggestion(name)}
                press="chip"
                accessibilityRole="button"
                // The a11y label carries the "taken" that the strikethrough
                // carries visually — TalkBack reads neither a line through text
                // nor the colour it is drawn in.
                accessibilityLabel={taken ? `${name}, already taken` : `Use ${name}`}
                testID={`profile-setup-suggestion-${i}`}
                style={[styles.suggestChip, chosen && styles.suggestChipChosen]}>
                <Text
                  allowFontScaling
                  style={[styles.suggestLabel, taken && styles.suggestLabelTaken]}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={rerollSuggestions}
            press="chip"
            accessibilityRole="button"
            accessibilityLabel="Suggest three more usernames, and replace a suggested name in the field"
            testID="profile-setup-suggestion-reroll"
            style={styles.suggestReroll}>
            <Text allowFontScaling style={styles.suggestRerollLabel}>
              Try another
            </Text>
          </Pressable>
        </View>

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
            onPress={() => {
              setTermsChecked(v => !v);
              // Clear the refusal on ANY interaction with the box, including
              // unticking it again — the cue answers the last Continue press,
              // not the current state, and leaving it up after a deliberate
              // tap would read as the tap not having registered.
              setTermsRefused(false);
            }}
            press="none"
            highlight="dim"
            accessibilityRole="checkbox"
            checked={termsChecked}
            accessibilityLabel="Accept terms and privacy"
            testID="profile-setup-terms"
            size={22}
            style={styles.checkboxHit}>
            <View
              style={[
                styles.checkbox,
                termsChecked && styles.checkboxOn,
                termsRefused && !termsChecked && styles.checkboxRefused,
              ]}>
              {termsChecked ? (
                <Icon name="check" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
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
        {/*
          * The inline cue. `accessibilityLiveRegion` so TalkBack announces it
          * when it appears rather than only on next focus — the member has just
          * pressed a button and heard nothing, which is the same dead-end in
          * audio that the missing NoticeBar was on screen.
          */}
        {termsRefused && !termsChecked ? (
          <Text
            allowFontScaling
            accessibilityLiveRegion="polite"
            testID="profile-setup-terms-required"
            style={styles.termsRequired}>
            Accept the terms to continue.
          </Text>
        ) : null}
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
    /*
     * The language row. `2xs` and not the `xs` the age row above uses, matching
     * the inline flow's `languageChips`: an M3 filter chip already carries its
     * own 8dp start padding and a reserved 18dp icon slot, so the same gap that
     * reads as tight between four bare pills reads as loose between six chips
     * that are each wider than their label. The chip's height comes from
     * `FilterChip` and is deliberately not set here.
     */
    languageChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
      marginTop: TOKENS.space.sm,
      marginBottom: TOKENS.space.lg,
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
    /* Only the gap above the field is left here — the label, container, stroke
       and padding are M3Field's. */
    field: {
      marginTop: TOKENS.space.md,
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
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /* Deliberately NOT `state.danger`: a failed check is not a rejection, and
       painting it in the same red as "already taken" is the whole mistake this
       state exists to avoid. text/accent is the app's actionable colour and it
       sits beside a real control. */
    statusRetry: {
      color: t.color.text.accent,
    },
    statusRetryHit: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.sm,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentTint,
    },
    statusRetryLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.accent,
    },
    suggestHint: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
      marginTop: TOKENS.space.xs,
    },
    suggestRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /*
     * 48dp tall, where the provider screen's twin of this pill is ~24dp and
     * leans on Pressable's hitSlop. Stated because it is a deliberate departure
     * from the control being mirrored.
     *
     * developer.android.com/guide/topics/ui/accessibility/apps ("Use large,
     * simple controls") sets the 48dp minimum, and hitSlop does not satisfy it
     * here: it grows the touch region but not the accessibility node, so
     * TalkBack's and Switch Access's target stays the visible pill (measured on
     * device, 2026-09-09). The age chips six lines down this same file already
     * take `interaction.minTarget` for that reason, and a row of four pills that
     * disagreed with them about height on one screen would read as two systems.
     */
    suggestChip: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.sm,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.sunken,
    },
    /* The one in the field. A ring, not a fill: the chip is not a selection
       that persists — it is a shortcut to a value the member can then edit, and
       filling it would claim more than that. */
    suggestChipChosen: {
      borderColor: t.color.border.accent,
    },
    suggestLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.primary,
    },
    /*
     * Struck through as well as dimmed, so the "taken" does not rest on colour
     * alone (WCAG 1.4.1, the same requirement the refused checkbox answers
     * above). The status line under the field says it in words at the same
     * moment, and the chip's accessibility label carries it for TalkBack.
     */
    suggestLabelTaken: {
      color: t.color.text.tertiary,
      textDecorationLine: 'line-through',
    },
    /* Token for token the provider screen's `nameReroll`, with this screen's
       48dp target: the same control, so it wears the same pill. */
    suggestReroll: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentTint,
    },
    suggestRerollLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.accent,
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
    /*
     * The refused state: `state/danger` on the border, and colour is not the
     * only carrier — the inline line below says it in words, and TalkBack
     * announces that line. A border that merely changes hue would fail anyone
     * who cannot see the difference.
     */
    checkboxRefused: {
      borderColor: t.color.state.danger,
      borderWidth: 1.5,
    },
    termsRequired: {
      ...TOKENS.typography.bodySmall,
      color: t.color.state.danger,
      marginBottom: TOKENS.space.sm,
    },
    checkboxHit: {
      // Keep the visible box aligned to the text. Pressable's size prop expands
      // this 22dp visual to the Android 48dp touch target with hitSlop.
      width: 22,
      height: 22,
      // Matches `checkbox` below so the state layer is clipped to the shape the
      // user can see. Without it the layer took the hit box's square corners and
      // the `dim` fill leaked past the rounded checkbox at all four corners. A
      // rounded square, not a circle — see the note on CHECKBOX_RADIUS.
      borderRadius: CHECKBOX_RADIUS,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: CHECKBOX_RADIUS,
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
