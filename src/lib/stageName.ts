/**
 * Stage names for providers: a suggestion to start from, and a check that the
 * name they end up with is not them.
 *
 * A provider's stage name is the only name a member ever sees (the PAN name is
 * for tax and payouts and never leaves the server). Two failure modes on the
 * blank field, both seen in review: people type their real first name because
 * it is the first name that comes to mind, and people stall because "pick a
 * name" is a creative task at the end of a form. So the field opens FILLED with
 * a suggestion — editable, re-rollable — and typing over it gets a warning when
 * what they typed looks like their own name or a phone number (goal item 8,
 * 2026-09-05: "suggested name for provider onboarding + warning on edit, no PII").
 *
 * Every suggestion satisfies `check_display_name` (migration 040): 3–24 chars,
 * `[A-Za-z0-9_]` only. CamelCase because the charset has no space. Words are
 * warm, place-and-nature, some of them ours (chai, banyan, monsoon), none of
 * them a caste, a faith or a body — this is what a stranger reads at 2am.
 */

/** Kept in step with `check_display_name` and `USERNAME_PATTERN` in username.ts. */
export const STAGE_NAME_MAX = 24;

export const STAGE_NAME_ADJECTIVES: readonly string[] = [
  'Quiet',
  'Warm',
  'Steady',
  'Gentle',
  'Kind',
  'Calm',
  'Patient',
  'Bright',
  'Soft',
  'Still',
  'Open',
  'Clear',
  'Mellow',
  'Sunny',
  'Easy',
  'Cosy',
];

export const STAGE_NAME_NOUNS: readonly string[] = [
  'Harbour',
  'Lantern',
  'River',
  'Meadow',
  'Willow',
  'Ember',
  'Compass',
  'Anchor',
  'Haven',
  'Orchard',
  'Monsoon',
  'Chai',
  'Lotus',
  'Banyan',
  'Saffron',
  'Marigold',
  'Jasmine',
  'Peepal',
  'Veranda',
  'Courtyard',
];

/**
 * One suggestion, e.g. "QuietHarbour". `random` is injectable so a test can
 * walk the whole space; the product path uses Math.random. Uniqueness is the
 * server's job (`check_display_name` → 'taken'); the caller re-rolls.
 */
export function suggestStageName(random: () => number = Math.random): string {
  const pick = (list: readonly string[]): string => {
    const at = Math.min(list.length - 1, Math.max(0, Math.floor(random() * list.length)));
    return list[at] ?? list[0] ?? '';
  };
  return `${pick(STAGE_NAME_ADJECTIVES)}${pick(STAGE_NAME_NOUNS)}`;
}

/** What a stage name must not be. */
export type StageNamePii = 'real_name' | 'phone';

/** Words in a name: split on underscores, digits and CamelCase seams, lower-cased. */
function words(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/**
 * Whether a stage name gives the provider away.
 *
 * - `phone`: six or more digits in a row, or eight or more digits in total.
 *   Indian mobiles are ten; the second rule catches "98765_43210" written with
 *   a separator, and neither fires on a "Quiet22" or a "Room101_Flat2024".
 * - `real_name`: any word of the stage name equals, starts with or ends with a
 *   word (≥3 letters) of the PAN-verified name. Boundary-anchored on purpose:
 *   "ravilistens" is Ravi and is caught; "Gravity" merely contains "ravi" and
 *   is not. Case-insensitive because PAN names arrive in capitals.
 *
 * A heuristic, so the screen WARNS on `real_name` and only BLOCKS on `phone`.
 */
export function stageNamePii(name: string, verifiedName: string | null): StageNamePii | null {
  if (/\d{6,}/.test(name) || name.replace(/\D/g, '').length >= 8) {
    return 'phone';
  }
  if (verifiedName === null || verifiedName.trim() === '') {
    return null;
  }
  const real = words(verifiedName).filter(w => w.length >= 3);
  if (real.length === 0) {
    return null;
  }
  for (const mine of words(name)) {
    for (const theirs of real) {
      if (mine === theirs || mine.startsWith(theirs) || mine.endsWith(theirs)) {
        return 'real_name';
      }
    }
  }
  return null;
}

/** The sentence under the field for each kind of hit. */
export function stageNamePiiMessage(kind: StageNamePii): string {
  return kind === 'phone'
    ? 'Don’t put a phone number in your stage name.'
    : 'That looks like your real name. Members only ever see your stage name, so pick one that isn’t you.';
}

/** The standing hint while the suggestion is untouched. */
export const STAGE_NAME_HINT = 'Suggested for you. Try another, or type your own.';
