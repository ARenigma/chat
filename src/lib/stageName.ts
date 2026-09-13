/**
 * Names we suggest, and a check that the name a provider ends up with is not
 * them.
 *
 * Two generators live here, one per side of the app, because they share the one
 * thing that can break them: the charset `check_display_name` enforces. A
 * suggestion that cannot pass that RPC is not a suggestion, it is a dead end the
 * member has to notice and undo — so both lists and both shapes are pinned to it
 * by the same test.
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
 * A list index from one draw, clamped at both ends.
 *
 * `Math.random()` never returns 1, but an injected source in a test does, and
 * `list[list.length]` is `undefined` — which used to reach the caller as an
 * empty half of a name. Clamping here rather than at each call site keeps the
 * two generators below reading the same draw the same way.
 */
function indexFrom(length: number, draw: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(draw * length)));
}

function pickFrom(list: readonly string[], draw: number): string {
  return list[indexFrom(list.length, draw)] ?? list[0] ?? '';
}

/**
 * One suggestion, e.g. "QuietHarbour". `random` is injectable so a test can
 * walk the whole space; the product path uses Math.random. Uniqueness is the
 * server's job (`check_display_name` → 'taken'); the caller re-rolls.
 */
export function suggestStageName(random: () => number = Math.random): string {
  // Two draws, adjective then noun. Template substitutions evaluate left to
  // right, so the order a seeded test feeds them in is the order they land.
  return `${pickFrom(STAGE_NAME_ADJECTIVES, random())}${pickFrom(STAGE_NAME_NOUNS, random())}`;
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

/* ==========================================================================
 * Member usernames — same mechanism, different voice
 * ========================================================================== */

/**
 * Handles in the register of Hindi pop culture, e.g. "Baazigar_42".
 *
 * A DIFFERENT list from the provider's, on purpose, because the two names do
 * different work. A provider's stage name is what a stranger reads at 2am when
 * they are looking for someone calm, so that list is nature and weather and
 * nothing louder. A member's username is a handle — it is theirs, it is playful,
 * and nobody is choosing a listener by reading it. Amit's brief (2026-09-12) was
 * films, characters, comics and shows, with "baazigar123!" as the example.
 *
 * Two constraints shape what is in it:
 *
 * - **Ordinary words first.** Almost every entry is a plain Hindi/Urdu word that
 *   happens to carry film weight — jaadu (magic), masala (spice), jugaad (a
 *   workaround), jhakaas (brilliant), tashan (swagger), sholay (embers),
 *   baazigar (one who plays). The reference lands without the word
 *   being anybody's mark. Where a proper noun earns its place it is a fictional
 *   character (Gabbar, Mogambo, Basanti, Circuit, Chulbul), never a performer:
 *   a handle that reads as a real person is an impersonation, and this app puts
 *   strangers in a private room together.
 * - **No common first names.** "Rahul", "Simran", "Anjali" are references and
 *   also what a third of the directory is actually called, so they read as a
 *   real name rather than a joke.
 */
export const POP_USERNAME_WORDS: readonly string[] = [
  'Baazigar',
  'Sholay',
  'Deewana',
  'Rangeela',
  'Jhakaas',
  'Bindaas',
  'Dhamaal',
  'Masala',
  'Filmi',
  'Interval',
  'Jugaad',
  'Qawwali',
  'Tashan',
  'Jalebi',
  'Chaiwala',
  'Dhinchak',
  'Gabbar',
  'Mogambo',
  'Circuit',
  'Basanti',
  'Chulbul',
  'Jaadu',
  'Talkies',
  'Shehzada',
];

/** How many suggestions the member is offered at once. */
export const USERNAME_SUGGESTION_COUNT = 3;

/**
 * The trailing number: two or three digits.
 *
 * Amit's example ends in "123". Three digits is the shape, but a two-digit tail
 * reads just as much like a handle and roughly doubles the space, and the space
 * is the whole point — 24 words × 990 numbers × 2 separators is ~47,500 names,
 * so a fresh set is unlikely to collide with anything already claimed and the
 * member rarely has to re-roll past a "taken".
 *
 * Never four or more: `stageNamePii` reads 6+ consecutive digits as a phone
 * number, and while the member screen does not run that check, a suggested name
 * that the provider screen would warn about is a suggestion we would have to
 * explain.
 */
const USERNAME_NUMBER_MIN = 10;
const USERNAME_NUMBER_MAX = 999;

/**
 * Word + optional separator + number.
 *
 * The separator is an UNDERSCORE and not the "!" in Amit's "baazigar123!",
 * which is a deviation stated rather than silently made: `check_display_name`
 * (migration 040, the last definition) answers `'^[a-zA-Z0-9_]+$'` with
 * `{status: 'invalid', message: 'Letters, numbers, and underscores only.'}`, so
 * a suggestion carrying "!" could be tapped, would fail the live check, and
 * would have to be edited by hand before Continue lit. Underscore is the only
 * punctuation the charset has, so it is the one that keeps the shape.
 */
function decorate(word: string, random: () => number): string {
  const span = USERNAME_NUMBER_MAX - USERNAME_NUMBER_MIN + 1;
  const number = USERNAME_NUMBER_MIN + indexFrom(span, random());
  const separator = random() < 0.5 ? '_' : '';
  return `${word}${separator}${number}`;
}

/**
 * A set of member usernames to offer at once, e.g. ["Jhakaas_207", …], all
 * different.
 *
 * No single-name twin of `suggestStageName` beside this one: the member screen
 * offers three at a time and nothing in the app wants one, and an exported
 * generator with no caller is a second definition of the shape waiting to drift
 * from this one. `suggestUsernames(1, …)` is the single name.
 *
 * The words are consecutive from a random start rather than redrawn per slot,
 * which is what makes "all different" structural instead of probabilistic.
 * Redrawing needs a retry loop, and a retry loop has to decide what to do when
 * it fails — with `random` injectable, a source that returns a constant (a
 * seeded test, or a stubbed one) makes it fail every time. Walking the list
 * cannot repeat a word, so it cannot repeat a name, so there is no loop and no
 * failure case.
 *
 * `count` is clamped to the list rather than trusted: asking for more names than
 * there are words would wrap the walk and hand back duplicates, which is the one
 * thing this function promises not to do.
 */
export function suggestUsernames(
  count: number = USERNAME_SUGGESTION_COUNT,
  random: () => number = Math.random,
): string[] {
  const wanted = Math.min(Math.max(1, Math.floor(count)), POP_USERNAME_WORDS.length);
  const start = indexFrom(POP_USERNAME_WORDS.length, random());
  const names: string[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const word = POP_USERNAME_WORDS[(start + i) % POP_USERNAME_WORDS.length] ?? '';
    names.push(decorate(word, random));
  }
  return names;
}

/** The lead-in above the suggestion chips. Mirrors `STAGE_NAME_HINT`'s voice. */
export const USERNAME_SUGGESTION_HINT = 'Tap one, or type your own.';
