/**
 * The provider's Edit profile form, as pure functions: what the draft starts
 * from, whether it changed, what the server would refuse, and which of the two
 * writes a save needs.
 *
 * Kept out of the screen so the rules are tested without rendering, and so
 * they sit next to the server rules they mirror. Every limit here is the
 * database's, restated so Save is disabled BEFORE a write the server refuses
 * with a constraint the provider cannot act on:
 *
 *   displayName 2..30 after trimming   profiles CHECK, update_provider_profile (190)
 *   headline    1..140 after trimming   profiles CHECK (006), update_provider_profile (180)
 *   about       1..2000 after trimming  profiles CHECK (042), update_provider_profile (180)
 *   languages   1..12                   profiles_provider_has_a_language (075),
 *                                       language_list_is_sane (072)
 *   expertise   0..8                    expertise_list_is_sane (083)
 *
 * The contact guard (157) is the one rule NOT mirrored here: in shadow mode the
 * server saves and logs, so a client prediction would refuse what the server
 * accepts. Its P0011 refusal is mapped after the save instead.
 *
 * Display name validation mirrors update_provider_profile's new checks (190):
 * reserved words and phone numbers are caught client-side; uniqueness is checked
 * live via check_display_name (which the screen wires through useCheckDisplayName
 * from api/profileSetup.ts).
 */
import type { Profile } from './database.types';
import { MAX_EXPERTISE } from './expertise';
import { MAX_PREFERRED_LANGUAGES } from './languagePrefs';

export const HEADLINE_MAX = 140;
export const ABOUT_MAX = 2000;
/** `language_list_is_sane` caps both language columns at twelve. */
export const MAX_PROVIDER_LANGUAGES = MAX_PREFERRED_LANGUAGES;

/** Display name limits — 2–30 chars, matching update_provider_profile (190). */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;

/** Reserved words the server refuses (case-insensitive substring, 190). */
const RESERVED_WORDS = [
  'pappal', 'support', 'admin', 'official', 'team', 'staff', 'moderator', 'help',
] as const;

/** Mirrors stageNamePii's phone branch: ≥6 consecutive digits or ≥8 digits total. */
function containsPhone(name: string): boolean {
  return /\d{6,}/.test(name) || name.replace(/\D/g, '').length >= 8;
}

/** True when `name` contains a reserved platform word as a substring (case-insensitive). */
function containsReservedWord(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_WORDS.some(w => lower.includes(w));
}

export interface ProfileEditDraft {
  displayName: string;
  headline: string;
  about: string;
  languages: readonly string[];
  expertise: readonly string[];
}

export type ProfileEditField = keyof ProfileEditDraft;

export type ProfileEditErrors = Partial<Record<ProfileEditField, string>>;

/** The form's starting point, from the provider's own profile row. */
export function draftFromProfile(
  profile: Pick<Profile, 'display_name' | 'headline' | 'about' | 'languages'> & { expertise?: string[] | null },
): ProfileEditDraft {
  return {
    displayName: profile.display_name ?? '',
    headline: profile.headline ?? '',
    about: profile.about ?? '',
    languages: [...(profile.languages ?? [])],
    expertise: [...(profile.expertise ?? [])],
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Which writes a save needs. Compared after trimming, which is what the server
 * stores: a trailing space typed and deleted is not a change.
 */
export function changedParts(
  initial: ProfileEditDraft,
  draft: ProfileEditDraft,
): { fields: boolean; expertise: boolean; name: boolean } {
  return {
    // `name` is separate so the screen can show the 30-day cooldown error
    // specifically on the name field without holding back the other fields.
    name: initial.displayName.trim() !== draft.displayName.trim(),
    fields:
      initial.headline.trim() !== draft.headline.trim() ||
      initial.about.trim() !== draft.about.trim() ||
      !sameList(initial.languages, draft.languages),
    expertise: !sameList(initial.expertise, draft.expertise),
  };
}

export function isProfileEditDirty(initial: ProfileEditDraft, draft: ProfileEditDraft): boolean {
  const parts = changedParts(initial, draft);
  return parts.name || parts.fields || parts.expertise;
}

/** The inline line per field, empty when the draft is saveable. */
export function validateProfileEdit(draft: ProfileEditDraft): ProfileEditErrors {
  const errors: ProfileEditErrors = {};
  const displayName = draft.displayName.trim();
  const headline = draft.headline.trim();
  const about = draft.about.trim();

  // Display name (2–30 chars; charset + reserved + phone checked client-side).
  if (displayName.length < DISPLAY_NAME_MIN) {
    errors.displayName = `Pick a name that is at least ${DISPLAY_NAME_MIN} characters.`;
  } else if (displayName.length > DISPLAY_NAME_MAX) {
    errors.displayName = `Keep it to ${DISPLAY_NAME_MAX} characters.`;
  } else if (!/^[a-zA-Z0-9_]+$/.test(displayName)) {
    errors.displayName = 'Letters, numbers, and underscores only.';
  } else if (containsReservedWord(displayName)) {
    errors.displayName = 'That name is not available.';
  } else if (containsPhone(displayName)) {
    errors.displayName = "Don’t put a phone number in your name.";
  }

  if (headline.length === 0) {
    errors.headline = 'Add a headline. It is the first line members read.';
  } else if (headline.length > HEADLINE_MAX) {
    errors.headline = `Keep it to ${HEADLINE_MAX} characters.`;
  }
  if (about.length === 0) {
    errors.about = 'Say a little about yourself.';
  } else if (about.length > ABOUT_MAX) {
    errors.about = `Keep it to ${ABOUT_MAX} characters.`;
  }
  if (draft.languages.length === 0) {
    errors.languages = 'Pick at least one language members can talk to you in.';
  } else if (draft.languages.length > MAX_PROVIDER_LANGUAGES) {
    errors.languages = `Pick up to ${MAX_PROVIDER_LANGUAGES}.`;
  }
  if (draft.expertise.length > MAX_EXPERTISE) {
    errors.expertise = `Pick up to ${MAX_EXPERTISE}.`;
  }
  return errors;
}

export function hasErrors(errors: ProfileEditErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The field a contact-guard refusal names, if it is one this form edits. */
export function refusedField(field: string | null | undefined): ProfileEditField | null {
  return field === 'displayName' ||
    field === 'headline' ||
    field === 'about' ||
    field === 'languages' ||
    field === 'expertise'
    ? field
    : null;
}
