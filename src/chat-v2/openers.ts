/**
 * The automated opener sequence, as rules rather than as a loop.
 *
 * `insert_next_opener` walks the approved opener templates one at a time and is
 * idempotent on the server (a per-conversation row lock plus a count cursor),
 * so a remount or a retry cannot duplicate a greeting. What the CLIENT owns is
 * narrower and is all here: who may run the loop at all, and how long the
 * typing indicator is held before each step.
 *
 * Pure and separate from the hook for the usual reason — the gate is a boolean
 * ladder whose failure mode is a fake "typing…" on a thread that already has a
 * hundred real messages in it, which reads perfectly correct in source.
 *
 * The four constants are V1's, to the millisecond, and a test asserts they
 * still match the literals in `src/screens/ChatScreen.tsx`: while both screens
 * exist, the same conversation opened on either must be paced the same way.
 */

/** The floor: also the beat before the FIRST opener, whose length is unknown. */
export const CHAT_V2_OPENER_TYPING_MIN_MS = 700;
/** The ceiling, so a long template cannot stall the thread. */
export const CHAT_V2_OPENER_TYPING_MAX_MS = 2200;
/** Reading pace: the beat is proportional to what is about to be said. */
export const CHAT_V2_OPENER_MS_PER_CHAR = 45;
/** The gap between one opener landing and the next beat starting. */
export const CHAT_V2_OPENER_PAUSE_MS = 450;

/**
 * How long to show the peer typing before the next opener lands.
 *
 * `null` is the first step, where nothing is known about the upcoming body —
 * the minimum beat, rather than a guess at an average length.
 */
export function chatV2OpenerBeat(upcoming: string | null): number {
  if (upcoming === null) {
    return CHAT_V2_OPENER_TYPING_MIN_MS;
  }
  return Math.min(
    CHAT_V2_OPENER_TYPING_MAX_MS,
    Math.max(
      CHAT_V2_OPENER_TYPING_MIN_MS,
      upcoming.length * CHAT_V2_OPENER_MS_PER_CHAR,
    ),
  );
}

/**
 * Does this conversation already have a real, human message in it.
 *
 * Mirrors `insert_next_opener`'s own `v_live` check (migration 045) so the
 * decision can be made client-side, from data the transcript has already
 * fetched, instead of by asking the RPC — which is the round trip the typing
 * indicator used to be shown across.
 */
export function chatV2HasLiveMessage(
  messages: readonly { origin?: string | null }[] | undefined,
): boolean {
  return (messages ?? []).some(m => m.origin === 'live');
}

export interface ChatV2OpenerGate {
  /** Not `profiles.role`: which side of THIS thread we are on. */
  isMemberSide: boolean;
  /** The benchmark route observes; it never writes. */
  benchmarkReadOnly: boolean;
  /** `useMessages` has answered. */
  messagesLoaded: boolean;
  hasLiveMessage: boolean;
}

/**
 * Whether this screen owns the opener loop.
 *
 * "Owns" is the word, because the loop must have exactly one owner: two
 * runners would walk the same server cursor against each other, and both would
 * hold the peer's typing indicator. The route picks one screen and this picks
 * one side of one thread, which together leave one.
 */
export function chatV2OwnsOpeners(input: ChatV2OpenerGate): boolean {
  return (
    input.isMemberSide &&
    !input.benchmarkReadOnly &&
    input.messagesLoaded &&
    !input.hasLiveMessage
  );
}
