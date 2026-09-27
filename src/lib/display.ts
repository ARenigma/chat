/**
 * Display helpers for provider identity.
 *
 * Providers choose a display name; there are no portraits yet, so the avatar is
 * a single initial derived from it. Derived rather than stored because a stored
 * initial is a second copy of the same fact that can fall out of step with it.
 */

export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed === '' ? '?' : (trimmed[0] as string).toUpperCase();
}

/**
 * Gender as Astrotalk-style shorthand beside the age: F-24, M-30.
 *
 * Amit, 2026-09-08: "gender letter before age like F-24, M-30".
 *
 * HERE AND NOT IN ProviderRow, which is where it was first written, because a
 * component in this repo cannot be unit-tested: importing a `.tsx` pulls in
 * `react-native-reanimated`, which throws `loadUnpackersWithCode` under jest
 * (there is no renderer in devDependencies). Every gate on a component is
 * therefore a source scan, and a source scan cannot check that 'other' maps to
 * null — only that the words appear. A pure function can be called.
 *
 * 'other' and null both return null rather than a letter. A letter for "other"
 * would either out somebody or invent a category to put them in, and neither is
 * a directory row's business; the age still shows on its own.
 */
export function genderLetter(gender: string | null): string | null {
  if (gender === 'female') {
    return 'F';
  }
  if (gender === 'male') {
    return 'M';
  }
  return null;
}

/**
 * A provider's name as a member sees it: the first name only (Amit,
 * 2026-09-27: "always render only first name of provider").
 *
 * Trimmed, then the first whitespace-separated token; a single-token name is
 * kept whole. Null, undefined and blank come back as '' so each caller keeps
 * its own fallback ('?', 'Your provider'), as it did for a missing name.
 *
 * The same rule runs server side in supabase/functions/_shared/names.ts for the
 * push titles; __tests__/providerFirstName.test.ts holds the two to one table.
 *
 * Nothing today needs two same-first-name providers told apart on one surface
 * (no list shows a disambiguator), so accessibility labels use the first name
 * too. The day one does, it needs a different fact (a handle), not the surname.
 */
const COURTESY_TITLE = /^(dr|mr|mrs|ms|miss|prof|shri|sri|smt)\.?$/iu;

/*
 * A leading courtesy title is skipped when a name follows it ("Dr. Kavya Iyer"
 * reads "Kavya"): Dr, Mr, Mrs, Ms, Miss, Prof, Shri, Sri, Smt, with or without
 * a full stop. "Pandit" and "Acharya" are kept on purpose: for an astrologer
 * they are the name members know, not a courtesy.
 */
export function providerFirstName(displayName: string | null | undefined): string {
  const trimmed = (displayName ?? '').trim();
  if (trimmed === '') {
    return '';
  }
  const [first, second] = trimmed.split(/\s+/u) as [string, string | undefined];
  return second !== undefined && COURTESY_TITLE.test(first) ? second : first;
}

export type ProviderCtaLabel = 'Notify' | 'Call' | 'Chat' | 'Video';

/**
 * The provider row's one verb (ProviderRow's CTA, #46). Away outranks every
 * channel; a provider who takes voice calls is called when the row can dial;
 * otherwise the verb names a channel they actually offer, chat first.
 *
 * So a voice-only provider on a row that cannot dial still reads "Call": the
 * press then opens the profile (ProviderRow's `onPress` fallback), and the
 * profile's Call button is the dial. The label names what they offer; it never
 * names a channel they do not (no "Chat" when chat is off).
 */
export function providerCtaLabel(input: {
  isAvailable: boolean;
  audioEnabled: boolean;
  chatEnabled: boolean;
  /** The row has a dial action to hand (ProviderRow's `onCall`). */
  canDial: boolean;
}): ProviderCtaLabel {
  if (!input.isAvailable) {
    return 'Notify';
  }
  if (input.audioEnabled && input.canDial) {
    return 'Call';
  }
  return input.chatEnabled ? 'Chat' : input.audioEnabled ? 'Call' : 'Video';
}
