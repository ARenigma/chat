/**
 * The V2 screen's derivations: what the member sees, and when the transcript
 * is allowed to move.
 *
 * Pure and separate from the controller for the reason `rows.ts` is: these are
 * boolean ladders that read correct and behave wrong — "is this a spinner, a
 * failure or a first-contact state", "may this arrival yank the list" — and a
 * source-grep over the screen cannot tell a right ladder from a wrong one.
 * Every rule here is asserted as a value.
 */
import type { ChatV2Row } from './rows';

export interface ChatV2MutationInput {
  benchmarkReadOnly: boolean;
  conversationId: string | undefined;
  selfId: string | undefined;
  providerId: string;
  needsOpen: boolean;
}

/**
 * Inputs for every hook that may write merely because the V2 screen mounted.
 *
 * Hooks stay unconditional; benchmark read-only mode removes their enabling
 * identifiers instead. Normal debug V2 receives the original values.
 */
export function chatV2MutationInputs(input: ChatV2MutationInput) {
  if (input.benchmarkReadOnly) {
    return {
      openProviderId: null,
      liveConversationId: undefined,
      liveSelfId: undefined,
      markReadConversationId: undefined,
      markReadSelfId: undefined,
      outboxConversationId: undefined,
      announceConversationId: undefined,
      announceEnabled: false,
    } as const;
  }
  return {
    openProviderId: input.needsOpen ? input.providerId : null,
    liveConversationId: input.conversationId,
    liveSelfId: input.selfId,
    markReadConversationId: input.conversationId,
    markReadSelfId: input.selfId,
    outboxConversationId: input.conversationId,
    announceConversationId: input.conversationId,
    announceEnabled: input.conversationId !== undefined,
  } as const;
}

export interface ChatV2LoadInput {
  /** `useConversations` has answered, successfully or not. */
  threadsLoaded: boolean;
  threadsError: boolean;
  /** The conversation list holds a thread for this peer. */
  knownThread: boolean;
  /** A conversation id exists, from the thread or from `open_conversation`. */
  conversationResolved: boolean;
  messagesLoaded: boolean;
  messagesPending: boolean;
  messagesError: boolean;
  /** `open_conversation` failed: there is no thread and no way to make one. */
  openError: boolean;
  rowCount: number;
}

export interface ChatV2LoadState {
  loading: boolean;
  loadError: boolean;
  empty: boolean;
}

/**
 * Spinner, failure, or first contact.
 *
 * Three rules, each of which has been got wrong here before:
 *
 * 1. A BRAND-NEW chat shows its first-contact state immediately. There is no
 *    thread, so nothing is on the wire that a spinner would be waiting for —
 *    `open_conversation` is creating the row in the background. The spinner is
 *    reserved for a KNOWN thread whose messages have never been fetched;
 *    cached rows render at once on a background refetch.
 * 2. A failed conversation list must not spin forever. `threads` is
 *    `undefined` on an error exactly as it is while loading, so the loading
 *    clause has to exclude the error or the screen hangs on a spinner.
 * 3. A THREADS-ONLY failure must not cover rows that are already on screen.
 *    The transcript is what the member came to read; hiding it behind
 *    "couldn't load this chat" because a SUMMARY query failed is the error
 *    overlay lying about what broke. A messages or open failure is different —
 *    those are the transcript itself, and they say so even over cache.
 */
export function chatV2LoadState(input: ChatV2LoadInput): ChatV2LoadState {
  const loading =
    (!input.conversationResolved &&
      !input.threadsLoaded &&
      !input.threadsError) ||
    (input.knownThread &&
      input.conversationResolved &&
      !input.messagesLoaded &&
      input.messagesPending);
  const loadError =
    !loading &&
    (input.messagesError ||
      input.openError ||
      (input.threadsError && input.rowCount === 0));
  const empty = !loading && !loadError && input.rowCount === 0;
  return { loading, loadError, empty };
}

export interface ChatV2ComposerInput {
  conversationResolved: boolean;
  openError: boolean;
  chatClosed: boolean;
  awaitingMemberConsent: boolean;
  offerExplicitStart: boolean;
  peerName: string;
}

export interface ChatV2ComposerState {
  disabled: boolean;
  placeholder: string;
}

/**
 * Whether the field takes a message, and what it says when it does not.
 *
 * "Message", full stop, whenever it can be typed in. Every disabled state
 * keeps its own sentence: a greyed-out field saying "Message" is the app
 * declining to say why it will not take one — which is what it did when
 * `open_conversation` failed and the placeholder still read "Message" over a
 * field that could never send.
 *
 * The order is by specificity, not by likelihood. `openError` first because it
 * is the only one the member can act on by retrying; the consent pair last
 * because the controls above the field already say the same thing.
 */
export function chatV2ComposerState(
  input: ChatV2ComposerInput,
): ChatV2ComposerState {
  if (input.openError) {
    return {
      disabled: true,
      placeholder: 'Couldn’t start this chat. Pull to try again.',
    };
  }
  if (input.chatClosed) {
    return {
      disabled: true,
      placeholder: `${input.peerName} is not taking chats right now`,
    };
  }
  if (input.offerExplicitStart) {
    return { disabled: true, placeholder: 'Start a session to keep talking' };
  }
  if (input.awaitingMemberConsent) {
    return { disabled: true, placeholder: 'Say yes above when you are ready' };
  }
  // Still resolving: off, but with nothing to explain yet.
  return { disabled: !input.conversationResolved, placeholder: 'Message' };
}

/**
 * How far (dp) the inverted transcript must be scrolled from the newest row
 * before an arrival counts as "missed" rather than as something to scroll to.
 *
 * Deliberately forgiving: this decides whether the member is genuinely reading
 * history versus glancing at the last couple of bubbles, and the second case
 * still expects the list to follow.
 */
export const CHAT_V2_PAGE_DOWN_THRESHOLD = 200;

/** Inverted list: offset grows toward older rows, 0 is the newest. */
export function chatV2ScrolledAway(offsetY: number): boolean {
  return offsetY > CHAT_V2_PAGE_DOWN_THRESHOLD;
}

/**
 * `pin` moves the list to the newest row, `count` adds to the page-down badge
 * instead, `idle` leaves both alone.
 */
type ChatV2ScrollAction = 'idle' | 'pin' | 'count';

export interface ChatV2Arrival {
  action: ChatV2ScrollAction;
  /**
   * Messages from the OTHER person that appeared in this commit.
   *
   * The number the badge adds, and it is a count of rows rather than of
   * commits. The effect it replaces did `n => n + 1` once per commit, so a
   * reconnect that delivered nine missed messages in one batch said "1" — at
   * exactly the moment the number is the whole reason to tap the control. Call
   * logs, session boundaries, the ping notice and the unread divider are not
   * messages and are not counted; nor is anything I sent myself.
   */
  peerArrivals: number;
}

/** The identity set one commit is compared against on the next one. */
export function chatV2RowIds(rows: readonly ChatV2Row[]): Set<string> {
  return new Set(rows.map(row => row.id));
}

/**
 * What a change in the transcript is allowed to do to the member's position,
 * and how much of it was mail.
 *
 * The rule this replaces was "scroll to offset 0 whenever `rows.length`
 * changed", which yanked anyone reading history back to the bottom on every
 * arrival — a peer message, a call log, a session boundary, the ping notice.
 *
 * The narrower rule is the reference app's own: `if (obj.isOut() &&
 * obj.wasJustSent) scrollToLastMessage()`, and a page-down badge for
 * everything else (ChatActivity.java). `rows[0]` being a message of mine is
 * this app's `isOut() && wasJustSent`: the only way a row I sent can newly
 * appear at the FRONT of a newest-first list is that I just sent it. A call
 * record, a system row and a divider are nobody's own send, so they count.
 *
 * Arrival is decided against the previous set of row IDS rather than against a
 * count, and that is what makes the two answers honest at once. A count cannot
 * tell three new messages from one, and it cannot tell an edit from an
 * arrival: an edit, a delete tombstone and a read receipt all rebuild every row
 * object without adding one, and none of them should move anybody or touch the
 * badge.
 */
export function chatV2Arrival(
  previousIds: ReadonlySet<string>,
  rows: readonly ChatV2Row[],
  scrolledAway: boolean,
): ChatV2Arrival {
  let added = 0;
  let peerArrivals = 0;
  for (const row of rows) {
    if (previousIds.has(row.id)) {
      continue;
    }
    added += 1;
    if (row.kind === 'message' && !row.mine) {
      peerArrivals += 1;
    }
  }
  if (added === 0) {
    return { action: 'idle', peerArrivals: 0 };
  }
  const newest = rows[0];
  const mine = newest?.kind === 'message' && newest.mine;
  if (mine) {
    // My own send pins, and pinning clears the badge — so what arrived
    // alongside it is reported but will not be added to a count nobody sees.
    return { action: 'pin', peerArrivals };
  }
  return { action: scrolledAway ? 'count' : 'pin', peerArrivals };
}
