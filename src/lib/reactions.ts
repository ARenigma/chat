/**
 * Reactions, reduced to what a bubble needs to draw, pure, so the reduction is
 * testable without a socket or a Postgres.
 *
 * The server stores one row per (message, user) with a closed emoji set, which is
 * the right shape for the write path and the wrong shape for rendering: a bubble
 * needs "which emoji are on me, how many of each, and is one of them mine". Doing
 * that grouping inside `renderItem` would redo it for every row on every frame of
 * a scroll.
 */
import type { MessageReaction, ReactionEmoji } from './database.types';

/**
 * The six, in the order they appear in the actions sheet.
 *
 * Must stay a subset of the CHECK constraint in migration 011, and the heart must
 * stay U+2764 U+FE0F: a bare U+2764 typechecks fine, looks identical in most
 * editors, and comes back `BAD_REQUEST` from every call. A contract assertion
 * compares this list to the SQL character for character.
 */
export const REACTION_CHOICES: readonly ReactionEmoji[] = [
  '❤️',
  '👍',
  '😂',
  '😮',
  '😢',
  '🙏',
];

export interface ReactionTally {
  emoji: ReactionEmoji;
  count: number;
  /** Whether the session's own user is one of the people who chose it. */
  mine: boolean;
}

/**
 * Group reaction rows by message.
 *
 * Ordered by `REACTION_CHOICES`, not by `created_at` and not by count. Both of
 * those reorder the pills under a bubble as the other person reacts, which is
 * movement in a transcript that nobody asked for; a fixed order means a pill
 * appears and disappears in place.
 */
export function tallyByMessage(
  rows: readonly MessageReaction[],
  selfId: string | undefined,
): Map<string, ReactionTally[]> {
  const byMessage = new Map<string, Map<ReactionEmoji, ReactionTally>>();

  for (const row of rows) {
    let forMessage = byMessage.get(row.message_id);
    if (forMessage === undefined) {
      forMessage = new Map();
      byMessage.set(row.message_id, forMessage);
    }
    const existing = forMessage.get(row.emoji);
    const mine = selfId !== undefined && row.user_id === selfId;
    if (existing === undefined) {
      forMessage.set(row.emoji, { emoji: row.emoji, count: 1, mine });
      continue;
    }
    existing.count += 1;
    // `||=` rather than `=`: whichever row arrived second must not clear the flag
    // the first one set. Both people reacting with the same emoji is the case
    // that gets this wrong, and it is also the common one.
    existing.mine = existing.mine || mine;
  }

  const out = new Map<string, ReactionTally[]>();
  for (const [messageId, tallies] of byMessage) {
    out.set(
      messageId,
      REACTION_CHOICES.map(e => tallies.get(e)).filter((v): v is ReactionTally => v !== undefined),
    );
  }
  return out;
}

/**
 * Which emoji the session's own user has on a message, if any.
 *
 * There is at most one, because the primary key is (message_id, user_id): picking
 * a second replaces the first. The sheet needs this to render the chosen emoji as
 * selected, and to know that tapping it again means "take it back".
 */
export function ownReaction(
  tallies: readonly ReactionTally[] | undefined,
  rows: readonly MessageReaction[],
  messageId: string,
  selfId: string | undefined,
): ReactionEmoji | null {
  if (selfId === undefined) {
    return null;
  }
  // Read from the rows rather than from the tallies: a tally says *somebody* mine
  // is in the group, and on a shared emoji that is not enough to say which one is
  // the caller's. `tallies` is accepted only so a caller with it to hand can skip
  // the scan when the message has no reactions at all.
  if (tallies !== undefined && tallies.length === 0) {
    return null;
  }
  return (
    rows.find(r => r.message_id === messageId && r.user_id === selfId)?.emoji ?? null
  );
}
