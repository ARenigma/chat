import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useImeSpace } from '../lib/useImeSpace';
import { OFFERED_LANGUAGES, isLanguageSelected, toggleLanguage } from '../lib/languagePrefs';
import { MAX_EXPERTISE, expertiseFor, isExpertiseSelected, toggleExpertise } from '../lib/expertise';
import { ContactGuardRefusalError } from '../lib/contactGuard';
import {
  ABOUT_MAX,
  HEADLINE_MAX,
  MAX_PROVIDER_LANGUAGES,
  changedParts,
  draftFromProfile,
  hasErrors,
  isProfileEditDirty,
  refusedField,
  validateProfileEdit,
  type ProfileEditDraft,
  type ProfileEditField,
} from '../lib/providerProfileEdit';
import { useProfile } from '../api/chat';
import { useSaveProviderProfile } from '../api/provider';
import { BackButton } from '../components/BackButton';
import { FilterChip } from '../components/Chip';
import { M3Field } from '../components/TextField';
import { Pressable } from '../components/Pressable';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

interface Props {
  onBack: () => void;
  /** Published whenever the form's dirty state changes, for the route's back guard. */
  onDirtyChange: (dirty: boolean) => void;
  /** After a save lands: the route leaves without asking. */
  onSaved: () => void;
}

/** The union of what is offered and what is already chosen, offered order first. */
function withChosen(offered: readonly string[], chosen: readonly string[]): string[] {
  const fold = (v: string) => v.trim().toLowerCase();
  const seen = new Set(offered.map(fold));
  return [...offered, ...chosen.filter(c => !seen.has(fold(c)))];
}

/**
 * Edit profile: the headline, about, languages and expertise tags a LIVE
 * provider could not change anywhere until now (the application form is the
 * only other writer, and runs once).
 *
 * After Bluesky's EditProfileDialog (social-app
 * src/screens/Profile/Header/EditProfileDialog.tsx): Save in the header,
 * disabled until something changed and while anything is invalid; the
 * validation line under the field it is about; and leaving with unsaved
 * changes asks "Discard changes?" — here through the route's
 * `usePreventRemove`, so hardware back, the header arrow and a tab re-press
 * all reach the same question.
 *
 * Validation mirrors the server's CHECKs (src/lib/providerProfileEdit.ts). The
 * contact guard is not predicted: in shadow mode the server saves and logs, so
 * its P0011 refusal is shown after the save, under the field it names.
 *
 * Languages and topics are `FilterChip`s — M3's control for choosing several
 * from a set — not the conversation-starter `Chip`, whose label reads
 * "Start with: …" to TalkBack.
 *
 * No motion: a form opened a few times a month has nothing to animate, and the
 * push is the stack's default. The IME is part of the layout under
 * edge-to-edge, so the root pads by `useImeSpace` as the application form does.
 * https://developer.android.com/develop/ui/views/layout/sw-keyboard
 */
export function ProviderEditProfileScreen({ onBack, onDirtyChange, onSaved }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const imeSpace = useImeSpace();
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  const { data: profile } = useProfile();
  const save = useSaveProviderProfile();

  const initial = useMemo<ProfileEditDraft | null>(
    () => (profile ? draftFromProfile(profile) : null),
    [profile],
  );
  // Null until the provider types: the form follows the loaded profile until
  // then, and again after a save, so a refetch re-seeds it.
  const [edited, setEdited] = useState<ProfileEditDraft | null>(null);
  const [serverError, setServerError] = useState<{ field: ProfileEditField | null; message: string } | null>(
    null,
  );
  const draft = edited ?? initial;
  const dirty = initial !== null && draft !== null && isProfileEditDirty(initial, draft);
  const errors = useMemo(() => (draft ? validateProfileEdit(draft) : {}), [draft]);
  const canSave = dirty && !hasErrors(errors) && !save.isPending;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const update = useCallback(
    (patch: Partial<ProfileEditDraft>) => {
      // Frozen while a save is in flight: its success clears the draft and
      // leaves, so an edit typed meanwhile would be dropped without a word.
      if (draft === null || save.isPending) {
        return;
      }
      setServerError(null);
      setEdited({ ...draft, ...patch });
    },
    [draft, save.isPending],
  );

  const onSave = useCallback(() => {
    if (!canSave || initial === null || draft === null) {
      return;
    }
    save.mutate(
      {
        headline: draft.headline,
        about: draft.about,
        languages: [...draft.languages],
        expertise: [...draft.expertise],
        parts: changedParts(initial, draft),
      },
      {
        onSuccess: () => {
          setEdited(null);
          onSaved();
        },
        onError: err => {
          setServerError(
            err instanceof ContactGuardRefusalError
              ? { field: refusedField(err.refusal.field), message: err.message }
              : { field: null, message: 'Could not save your profile. Try again.' },
          );
        },
      },
    );
  }, [canSave, initial, draft, save, onSaved]);

  const offeredTopics = expertiseFor(profile?.provider_category ?? 'listener');
  const languageOptions = withChosen(OFFERED_LANGUAGES, draft?.languages ?? []);
  const topicOptions = withChosen(offeredTopics, draft?.expertise ?? []);
  // Rules show once the provider has changed something, not on arrival, so
  // an empty legacy about does not open the page in red; from the first edit
  // every rule that holds Save back is on screen, next to its field.
  const lineFor = (field: ProfileEditField): string | null =>
    serverError?.field === field ? serverError.message : dirty ? errors[field] ?? null : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: imeSpace }]} testID="edit-profile">
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="edit-profile-back" style={styles.barIcon} />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          allowFontScaling
          style={styles.barTitle}>
          Edit profile
        </Text>
        {/* A text action, as Bluesky's dialog header carries it. `disabled`
            rather than hidden, so the provider can see where saving happens
            before there is anything to save. The label itself swaps to the
            participle while the write is in flight, and TalkBack reads the
            same word. */}
        <Pressable
          onPress={onSave}
          disabled={!canSave}
          testID="edit-profile-save"
          accessibilityLabel={save.isPending ? 'Saving' : 'Save'}
          press="none"
          highlight="dim"
          style={styles.save}>
          <Text allowFontScaling style={[styles.saveLabel, !canSave && styles.saveLabelDisabled]}>
            {save.isPending ? 'Saving' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        {...SCROLL_PHYSICS}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: imeSpace > 0 ? TOKENS.space.md : barOffset }]}>
        {serverError !== null && serverError.field === null ? (
          <Text allowFontScaling style={styles.error} testID="edit-profile-error">
            {serverError.message}
          </Text>
        ) : null}

        <M3Field
          label="Headline"
          testID="edit-profile-headline"
          value={draft?.headline ?? ''}
          onChangeText={headline => update({ headline })}
          placeholder={'“I listen more than I talk”'}
          maxLength={HEADLINE_MAX}
          editable={draft !== null}
          supportingText={`${(draft?.headline ?? '').trim().length} / ${HEADLINE_MAX}`}
          error={lineFor('headline')}
        />

        <M3Field
          label="About"
          testID="edit-profile-about"
          value={draft?.about ?? ''}
          onChangeText={about => update({ about })}
          placeholder="Why are you good at this?"
          multiline
          maxLength={ABOUT_MAX}
          editable={draft !== null}
          supportingText={`${(draft?.about ?? '').trim().length} / ${ABOUT_MAX}`}
          error={lineFor('about')}
          style={styles.about}
        />

        <View style={styles.field}>
          <Text allowFontScaling style={styles.fieldLabel}>
            {`Languages (at least 1, up to ${MAX_PROVIDER_LANGUAGES})`}
          </Text>
          <View style={styles.chips} testID="edit-profile-languages">
            {languageOptions.map(l => {
              const picked = isLanguageSelected(draft?.languages ?? [], l);
              return (
                <FilterChip
                  key={l}
                  label={l}
                  selected={picked}
                  onToggle={value => update({ languages: toggleLanguage(draft?.languages ?? [], value) })}
                  disabled={draft === null}
                  accessibilityLabel={`${l}${picked ? ', selected' : ''}`}
                  testID={`edit-profile-language-${l}`}
                />
              );
            })}
          </View>
          {lineFor('languages') !== null ? (
            <Text allowFontScaling style={styles.error}>
              {lineFor('languages')}
            </Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text allowFontScaling style={styles.fieldLabel}>
            {`What you help with (optional, up to ${MAX_EXPERTISE})`}
          </Text>
          {/* The ceiling disables the unpicked chips rather than letting a tap
              do nothing invisibly, as the application form does. */}
          <View style={styles.chips} testID="edit-profile-expertise">
            {topicOptions.map(topic => {
              const picked = isExpertiseSelected(draft?.expertise ?? [], topic);
              return (
                <FilterChip
                  key={topic}
                  label={topic}
                  selected={picked}
                  onToggle={value =>
                    update({ expertise: toggleExpertise(draft?.expertise ?? [], value, offeredTopics) })
                  }
                  disabled={draft === null || (!picked && (draft?.expertise.length ?? 0) >= MAX_EXPERTISE)}
                  accessibilityLabel={`${topic}${picked ? ', selected' : ''}`}
                  testID={`edit-profile-topic-${topic}`}
                />
              );
            })}
          </View>
          {lineFor('expertise') !== null ? (
            <Text allowFontScaling style={styles.error}>
              {lineFor('expertise')}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barIcon: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
    barTitle: { ...TOKENS.typography.textLgSemiBoldTight, color: t.color.text.primary, flex: 1 },
    // A 48dp target around a text action ("at least 48dp x 48dp",
    // developer.android.com/guide/topics/ui/accessibility/apps).
    save: {
      minWidth: TOKENS.interaction.minTarget,
      minHeight: TOKENS.interaction.minTarget,
      paddingHorizontal: TOKENS.space.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
    },
    saveLabel: { ...TOKENS.typography.labelLargeEmphasized, color: t.color.text.accent },
    // Disabled in the secondary ink, not an alpha: an alpha is a contrast the
    // token gate cannot see (walletTone.test's rule). M3 lets a disabled
    // control fall under the contrast floor; it still reads as present.
    saveLabelDisabled: { color: t.color.text.tertiary },
    scroll: { paddingHorizontal: TOKENS.space.md, paddingTop: TOKENS.space.sm, gap: TOKENS.space.lg },
    field: { gap: TOKENS.space.xs },
    fieldLabel: { ...TOKENS.typography.labelMedium, color: t.color.text.secondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: TOKENS.space['2xs'] },
    about: { minHeight: 110 },
    error: { ...TOKENS.typography.bodySmall, color: t.color.state.danger },
  });
