import { Platform } from 'react-native';
import {
  EMOJI,
  RANGES,
  SOURCE,
  type GeneratedCategoryId,
  type GeneratedEmoji,
} from './emoji.generated';

/**
 * The emoji dataset, and the three rules that make it behave like a keyboard:
 * what exists, what this device can DRAW, and how a search finds it.
 *
 * **History, because it reversed.** This file used to carry ~300 hand-typed
 * entries with a comment defending that choice under RULE 5. The comment was
 * wrong twice over. It argued a dependency was not worth its failure modes —
 * true of a picker COMPONENT, not of a dataset: `@emoji-mart/data` is a
 * devDependency read once by `scripts/gen-emoji.mjs`, ships no runtime code, no
 * render layer and no native code, and what lands in the bundle is a generated
 * TypeScript file this repo owns. And a hand-typed list is how a dataset
 * acquires typos and a search that finds nothing: 1,870 emoji with real keyword
 * indexes is not a thing to type (Amit, 2026-09-04).
 *
 * Regenerate with `npm run emoji`; `npm run emoji:check` fails the build on
 * drift, exactly like tokens and icons (RULE 4 — `emoji.generated.ts` is never
 * hand-edited).
 */

type EmojiCategoryId = 'recent' | GeneratedCategoryId;

export interface EmojiCategory {
  id: EmojiCategoryId;
  /** The tab glyph. A picker's own tabs are emoji in every keyboard. */
  glyph: string;
  label: string;
}

export interface Emoji {
  /** The base sequence, with no skin tone applied. */
  char: string;
  /** Lowercase words used by search: id, name, keywords, aliases, emoticons. */
  keywords: string;
  /**
   * The five pre-composed toned variants, light to dark, present only on emoji
   * that actually take a tone. Pre-composed rather than assembled, because the
   * modifier does NOT simply go on the end: in a ZWJ sequence it belongs inside,
   * once per person, and after a VS16 it replaces the selector. See `withTone`.
   */
  skins?: readonly string[];
}

/** Where the data came from, surfaced so the picker can assert it in a test. */
export { SOURCE };

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  { id: 'recent', glyph: '🕘', label: 'Recently used' },
  { id: 'smileys', glyph: '😀', label: 'Smileys and emotion' },
  { id: 'people', glyph: '👋', label: 'People and body' },
  { id: 'nature', glyph: '🐻', label: 'Animals and nature' },
  { id: 'food', glyph: '🍎', label: 'Food and drink' },
  { id: 'activity', glyph: '⚽', label: 'Activity' },
  { id: 'travel', glyph: '🚗', label: 'Travel and places' },
  { id: 'objects', glyph: '💡', label: 'Objects' },
  { id: 'symbols', glyph: '❤️', label: 'Symbols' },
  { id: 'flags', glyph: '🏳️', label: 'Flags' },
];

/**
 * The five Fitzpatrick modifiers, in the order every keyboard shows them, with
 * index 0 the default yellow.
 *
 * Kept as strings ONLY so the tone strip can render a swatch and so a stored
 * preference is a stable value. They are never concatenated onto an emoji any
 * more — `withTone` indexes `skins` instead. Appending was the old rule and it
 * was wrong for every couple, family and handshake in the set.
 */
export const TONES: readonly string[] = [
  '',
  '\u{1F3FB}',
  '\u{1F3FC}',
  '\u{1F3FD}',
  '\u{1F3FE}',
  '\u{1F3FF}',
];

/**
 * The newest Emoji version this device's system font can draw.
 *
 * A glyph the font does not have renders as tofu — a box — and a keyboard full
 * of boxes is worse than a shorter keyboard. Android ships a fixed Noto Color
 * Emoji per platform release, so the answer is a property of the API level, and
 * this is the published mapping (each Android release note names the Unicode /
 * Emoji version its font was built against).
 * https://developer.android.com/guide/topics/ui/look-and-feel/emoji-compat
 * https://unicode.org/emoji/techindex.html
 *
 * **Deliberately not `androidx.emoji2`.** EmojiCompat fixes tofu by drawing
 * emoji from a bundled or downloadable font through spans in Android TextViews.
 * RN's `<Text>` does not run its spans, the bundled font is ~10 MB, and the
 * downloadable path is a Play-services dependency and a network fetch to render
 * a keyboard. Hiding what cannot be drawn costs nothing and cannot fail.
 *
 * Anything at or below Emoji 4.0 is treated as universal — API 24 is our
 * `minSdkVersion` and Android 7 draws it — which is why the generator omits `v`
 * for those entries entirely.
 */
export function supportedEmojiVersion(apiLevel: number): number {
  if (apiLevel >= 35) return 15.1;
  if (apiLevel >= 34) return 15;
  if (apiLevel >= 33) return 14;
  if (apiLevel >= 31) return 13.1;
  if (apiLevel >= 30) return 13;
  if (apiLevel >= 29) return 12.1;
  if (apiLevel >= 28) return 11;
  if (apiLevel >= 26) return 5;
  return 4;
}

const SUPPORTED =
  Platform.OS === 'android' && typeof Platform.Version === 'number'
    ? supportedEmojiVersion(Platform.Version)
    : 15.1;

function toEmoji(e: GeneratedEmoji): Emoji {
  return e.s === undefined
    ? { char: e.n, keywords: e.k }
    : { char: e.n, keywords: e.k, skins: e.s };
}

function drawable(e: GeneratedEmoji): boolean {
  return e.v === undefined || e.v <= SUPPORTED;
}

/** Every category except `recent`, which is built at runtime from storage. */
export const EMOJI_BY_CATEGORY: Readonly<
  Record<GeneratedCategoryId, readonly Emoji[]>
> = (() => {
  const out = {} as Record<GeneratedCategoryId, readonly Emoji[]>;
  for (const r of RANGES) {
    out[r.id] = EMOJI.slice(r.start, r.end).filter(drawable).map(toEmoji);
  }
  return out;
})();

/** Flat list, for search. Built once at module load, not per keystroke. */
export const ALL_EMOJI: readonly Emoji[] = RANGES.flatMap(
  r => EMOJI_BY_CATEGORY[r.id],
);

/** Reverse lookup, so a stored recent string can be re-toned or re-rendered. */
const BY_CHAR = new Map<string, Emoji>();
for (const e of ALL_EMOJI) {
  BY_CHAR.set(e.char, e);
  if (e.skins !== undefined) {
    for (const s of e.skins) {
      BY_CHAR.set(s, e);
    }
  }
}

/** The base emoji a native string belongs to, toned or not. */
export function emojiForNative(char: string): Emoji | undefined {
  return BY_CHAR.get(char);
}

/**
 * Apply a skin tone, when the emoji takes one and a tone is chosen.
 *
 * `TONES[0]` is the default yellow, so `skins` is indexed at `i - 1`. An emoji
 * with no `skins` ignores the tone entirely rather than growing a loose swatch.
 */
export function withTone(emoji: Emoji, tone: string): string {
  if (emoji.skins === undefined || tone === '') {
    return emoji.char;
  }
  const i = TONES.indexOf(tone);
  return i > 0 ? (emoji.skins[i - 1] ?? emoji.char) : emoji.char;
}

/**
 * Prefix match over the keyword index.
 *
 * The index is one space-separated string per emoji with a LEADING space, so
 * `indexOf(' ' + q)` is a word-start match — the same anchoring emoji-mart uses,
 * re-expressed here. It matters at this size: a plain substring match over 1,870
 * entries puts "grinning" under "inn" and "raised hand" under "and". Linear over
 * ~1,870 short strings is sub-millisecond, so there is no trie to maintain.
 *
 * A blank query returns nothing so the caller falls back to browsing rather than
 * rendering the whole set as a "result".
 */
const INDEX: readonly string[] = ALL_EMOJI.map(e => ` ${e.keywords}`);

export function searchEmoji(query: string): readonly Emoji[] {
  const q = query.trim().toLowerCase();
  if (q === '') {
    return [];
  }
  const needle = ` ${q}`;
  const out: Emoji[] = [];
  for (let i = 0; i < INDEX.length; i += 1) {
    const row = INDEX[i];
    const hit = ALL_EMOJI[i];
    if (row !== undefined && hit !== undefined && row.includes(needle)) {
      out.push(hit);
    }
  }
  return out;
}
