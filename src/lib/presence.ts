/**
 * One reading of presence, so four screens cannot disagree about it.
 *
 * They did disagree. Before migration 012 the directory row, the inbox row, the
 * chat header and the provider's own inbox each derived a dot and a line
 * separately, from `is_available`, which is the provider's *listing* switch:
 * "listed for discovery and open to new conversations". Rendering that as a
 * presence dot said someone was there when it only meant they wanted work, and
 * the provider's inbox had given up entirely and hardcoded `online={false}`,
 * because `peer_available` is false for a member peer by construction.
 *
 * Kept pure and here rather than in a hook for the reason `datetime.ts` and
 * `transcript.ts` are: it is the part with rules in it, and it is testable
 * without booting the native runtime.
 */
import type { PresenceChoice } from './database.types';
import { listStamp } from './datetime';

export interface PresenceRead {
  /** Whether the avatar's dot lights. */
  here: boolean;
  /**
   * The line under the name, or null when nothing has been consented to. Null is
   * a real case and not an empty string: the chat header renders the name alone
   * rather than reserving a blank row, and a row that appears and disappears is
   * what made the header change height.
   */
  line: string | null;
}

const NOTHING: PresenceRead = { here: false, line: null };

/**
 * Fails closed on every unknown: a null presence means the peer has not loaded,
 * or is a row written before 012 and defaulted to `hidden`, and in both cases
 * inventing a state is worse than saying nothing. The one direction that must
 * never happen is showing somebody as present who did not say they were.
 *
 * `hidden` ignores `lastActiveAt` outright rather than trusting the two columns
 * to agree. They are stored independently: `presence_visible` gates the stamp
 * and `presence` is the declaration, and `useSetPresence` writes both so a user
 * only ever makes one choice. If they ever disagree, hidden wins, because hidden
 * is the one that was chosen to conceal.
 */
export function readPresence(
  presence: PresenceChoice | null | undefined,
  lastActiveAt: string | null | undefined,
  now: Date = new Date(),
): PresenceRead {
  if (presence === 'here') {
    return { here: true, line: 'Here now' };
  }
  if (presence === 'away') {
    // A stamp is strictly better information than the word, and it is only ever
    // present when they turned it on, so it is used when we have one.
    return {
      here: false,
      line:
        lastActiveAt !== null && lastActiveAt !== undefined && lastActiveAt !== ''
          ? `Last seen ${listStamp(lastActiveAt, now)}`
          : 'Away',
    };
  }
  return NOTHING;
}

/**
 * The same reading, lowercased, for an accessibility label that is read as part
 * of a sentence rather than on its own line. Separate from `line` so the visible
 * label can stay title-case without a screen reader announcing 'Here Now' mid
 * sentence.
 */
export function presenceForSpeech(read: PresenceRead): string | null {
  return read.line === null ? null : read.line.toLowerCase();
}

export interface PresenceOption {
  value: PresenceChoice;
  label: string;
  /** What choosing this actually does, in the second person. */
  detail: string;
}

/**
 * The three options and their consequences, in one place so the control and its
 * footer cannot drift. Ordered most to least public, which is also the order a
 * settings list should offer them in: the reader is scanning for the one that
 * describes what they want, and "publish nothing" is the end of that scale
 * rather than a fourth option hidden behind it.
 */
export const PRESENCE_OPTIONS: readonly PresenceOption[] = [
  {
    value: 'here',
    label: 'Here Now',
    detail: 'People you talk to can see you are around.',
  },
  {
    value: 'away',
    label: 'Away',
    detail: 'They see that you are not around, and when you last were.',
  },
  {
    value: 'hidden',
    label: 'Hidden',
    detail: 'Nobody is told anything about when you are here.',
  },
];

/** The footer under the group: what the current choice means, not all three. */
export function presenceDetail(presence: PresenceChoice): string {
  return (
    PRESENCE_OPTIONS.find(o => o.value === presence)?.detail ??
    PRESENCE_OPTIONS[PRESENCE_OPTIONS.length - 1]?.detail ??
    ''
  );
}
