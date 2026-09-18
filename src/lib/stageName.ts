/**
 * Names we suggest, and a check that the name a provider ends up with is not
 * them.
 *
 * Two generators live here, one per side of the app, because they share the one
 * thing that can break them: the charset `check_display_name` enforces. A
 * suggestion that cannot pass that RPC is not a suggestion, it is a dead end the
 * member has to notice and undo — so both voices and every word-shape are pinned
 * to it, in `scripts/gen-handles.mjs`, before a single word is emitted.
 *
 * The vocabulary is NOT here. It is `design/handles.json`, organised by domain,
 * compiled to `src/lib/handles.generated.ts` by `npm run handles`, and gated by
 * `npm run handles:check` — the same pipeline as tokens, icons and emoji. Amit,
 * 2026-09-17: "not hardcoded word list pls". The old three arrays spanned one
 * template and 320 names, and 320 collides constantly against a live
 * availability check; a suggestion that is usually taken is worse than none.
 * What replaced them is several declared word-shapes over a per-domain
 * vocabulary: 5.2M calm names, 33.5M pop names, and 8,760 / 16,912 of those
 * carry no number at all.
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
 * The two voices do different work, which is why they are different vocabularies
 * rather than one bag of words. A provider's stage name is what a stranger reads
 * at 2am when they are looking for someone calm, so `calm` is weather, water,
 * kitchens and trees and nothing louder. A member's username is a handle — it is
 * theirs, it is playful, nobody is choosing a listener by reading it — so `pop`
 * is Indian popular culture: cinema, music, food, streets, festivals, cricket,
 * folklore. Both lists are ordinary words that happen to carry the reference
 * (masala, jugaad, googly, jalebi); where a proper noun earns its place it is a
 * fictional character, never a performer, because a handle that reads as a real
 * person is an impersonation and this app puts strangers in a private room
 * together. No caste, no faith, no body, and no ordinary first name — the
 * generator refuses to emit any of them.
 */
import {
  HANDLE_MAX_LENGTH,
  HANDLE_NUMBER_MAX,
  HANDLE_NUMBER_MIN,
  HANDLE_TEMPLATES,
  HANDLE_WORDS,
  type HandleTemplate,
  type HandleVoice,
  type HandleWordRole,
} from './handles.generated';

/** Kept in step with `check_display_name` and `USERNAME_PATTERN` in username.ts. */
export const STAGE_NAME_MAX = HANDLE_MAX_LENGTH;

export const STAGE_NAME_ADJECTIVES: readonly string[] = HANDLE_WORDS.calm.adjective;
export const STAGE_NAME_NOUNS: readonly string[] = HANDLE_WORDS.calm.noun;

/**
 * A list index from one draw, clamped at both ends.
 *
 * `Math.random()` never returns 1, but an injected source in a test does, and
 * `list[list.length]` is `undefined` — which used to reach the caller as an
 * empty half of a name. Clamping here rather than at each call site keeps the
 * generators below reading the same draw the same way.
 */
function indexFrom(length: number, draw: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(draw * length)));
}

/**
 * One render of one template, e.g. "QuietHarbour", "RiverLantern", "Jalebi_207".
 *
 * Draw order is template-then-slots, left to right, and a number slot takes two
 * draws (value, then separator). A seeded test feeds them in that order.
 *
 * `firstIndex` pins the first slot instead of drawing it, which is what
 * `suggestUsernames` uses to make "all different" structural — see there.
 *
 * A role used twice in one template steps forward rather than redrawing, so
 * "RiverRiver" cannot happen and there is no retry loop to fail when an injected
 * source returns a constant. The generator has already proved the pool is bigger
 * than the number of slots that draw from it, so the step always terminates.
 */
function render(
  voice: HandleVoice,
  template: HandleTemplate,
  random: () => number,
  firstIndex: number | null,
): string {
  const taken: Partial<Record<HandleWordRole, number[]>> = {};
  let name = '';

  for (let slot = 0; slot < template.slots.length; slot += 1) {
    const role = template.slots[slot];
    if (role === undefined) {
      continue;
    }
    if (role === 'number') {
      const span = HANDLE_NUMBER_MAX - HANDLE_NUMBER_MIN + 1;
      const number = HANDLE_NUMBER_MIN + indexFrom(span, random());
      // Underscore is the only punctuation check_display_name allows, so it is
      // the only separator a suggestion can carry and still be tappable.
      const separator = random() < 0.5 ? '_' : '';
      name += `${separator}${number}`;
      continue;
    }

    const pool = HANDLE_WORDS[voice][role];
    const used = taken[role] ?? [];
    let index =
      slot === 0 && firstIndex !== null
        ? firstIndex % pool.length
        : indexFrom(pool.length, random());
    while (used.includes(index)) {
      index = (index + 1) % pool.length;
    }
    used.push(index);
    taken[role] = used;
    name += pool[index] ?? '';
  }

  return name;
}

/** One name in a given voice. The template is drawn first, uniformly. */
function suggestHandle(voice: HandleVoice, random: () => number): string {
  const templates = HANDLE_TEMPLATES[voice];
  const template = templates[indexFrom(templates.length, random())] ?? templates[0];
  return template === undefined ? '' : render(voice, template, random, null);
}

/**
 * One suggestion, e.g. "QuietHarbour". `random` is injectable so a test can walk
 * the space deterministically; the product path uses Math.random. Uniqueness is
 * the server's job (`check_display_name` → 'taken'); the caller re-rolls, and
 * the space is large enough that a re-roll is rare.
 */
export function suggestStageName(random: () => number = Math.random): string {
  return suggestHandle('calm', random);
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
 * The pop nouns, e.g. "Baazigar". Kept exported because it is the readable
 * summary of the member voice; the shapes that use it live in
 * `HANDLE_TEMPLATES.pop`.
 */
export const POP_USERNAME_WORDS: readonly string[] = HANDLE_WORDS.pop.noun;

/** How many suggestions the member is offered at once. */
export const USERNAME_SUGGESTION_COUNT = 3;

/**
 * A set of member usernames to offer at once, e.g. ["Jhakaas_207", …], all
 * different.
 *
 * No single-name twin of `suggestStageName` beside this one: the member screen
 * offers three at a time and nothing in the app wants one, and an exported
 * generator with no caller is a second definition of the shape waiting to drift
 * from this one. `suggestUsernames(1, …)` is the single name.
 *
 * One template for the whole set, and the first slot walks its pool from a
 * random start rather than being redrawn per slot. That is what makes "all
 * different" structural instead of probabilistic: distinct first words cannot
 * produce equal names. Redrawing needs a retry loop, and a retry loop has to
 * decide what to do when it fails — with `random` injectable, a source that
 * returns a constant (a seeded test, or a stubbed one) makes it fail every time.
 *
 * `count` is clamped to that first pool rather than trusted: asking for more
 * names than there are words would wrap the walk and hand back duplicates,
 * which is the one thing this function promises not to do.
 */
export function suggestUsernames(
  count: number = USERNAME_SUGGESTION_COUNT,
  random: () => number = Math.random,
): string[] {
  const templates = HANDLE_TEMPLATES.pop;
  const template = templates[indexFrom(templates.length, random())] ?? templates[0];
  if (template === undefined) {
    return [];
  }
  const lead = template.slots[0];
  const pool = lead === undefined || lead === 'number' ? [] : HANDLE_WORDS.pop[lead];
  const wanted = Math.min(Math.max(1, Math.floor(count)), Math.max(1, pool.length));
  const start = pool.length === 0 ? 0 : indexFrom(pool.length, random());

  const names: string[] = [];
  for (let i = 0; i < wanted; i += 1) {
    names.push(render('pop', template, random, start + i));
  }
  return names;
}

/** The lead-in above the suggestion chips. Mirrors `STAGE_NAME_HINT`'s voice. */
export const USERNAME_SUGGESTION_HINT = 'Tap one, or type your own.';
