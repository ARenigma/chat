/**
 * Recently-used emoji and the chosen skin tone, persisted.
 *
 * Most emoji use is repeat use, so "Recent" is the tab that actually gets used
 * and the one thing worth keeping across launches. Stored as a plain JSON array
 * of already-toned strings — what was inserted is what comes back, so a recent
 * entry needs no re-application of the tone rule.
 */
import { storage } from './storage';

const RECENTS_KEY = 'companion.emojiRecents';
const TONE_KEY = 'companion.emojiTone';

/** How many to keep. Two rows on a phone; beyond that it stops being "recent". */
const MAX_RECENTS = 16;

export function readRecents(): readonly string[] {
  const raw = storage.get(RECENTS_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // Trust nothing from storage: a shape change or a partial write must degrade
    // to "no recents" rather than throwing inside a render.
    return Array.isArray(parsed) ? parsed.filter(e => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

/** Most recent first, de-duplicated, capped. Returns the new list. */
export function pushRecent(emoji: string): readonly string[] {
  const next = [emoji, ...readRecents().filter(e => e !== emoji)].slice(0, MAX_RECENTS);
  storage.set(RECENTS_KEY, JSON.stringify(next));
  return next;
}

/** The Fitzpatrick modifier the user last picked, or '' for the default. */
export function readTone(): string {
  return storage.get(TONE_KEY) ?? '';
}

export function writeTone(tone: string): void {
  storage.set(TONE_KEY, tone);
}
