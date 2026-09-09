/**
 * Transcript reconciliation, pure, so it can be tested without a socket.
 *
 * Every list here is **newest-first**, because the transcript renders into an
 * inverted FlatList.
 *
 * The hard part is not receiving messages, it is receiving your own. A send
 * takes two independent paths back to the client: the `send_message` RPC
 * response, and a Realtime INSERT for the row it wrote. Either can arrive first,
 * and both describe the same message. On a slow network the RPC response can
 * even land after the peer's reply. So reconciliation is written to be
 * order-independent and idempotent rather than assuming a sequence:
 *
 *   - a row whose id is already present replaces it in place (never duplicates)
 *   - a row from this session matches the oldest pending row with the same body
 *   - anything else is inserted at its sorted position
 *
 * The alternative, a client-generated nonce column, would need a schema change
 * and would still need the id-based idempotency below, so it buys nothing.
 */
import type { Message } from './database.types';

/**
 * A transcript row, which is a server row plus one client-only field.
 *
 * `localKey` is the id the row had while it was optimistic, carried forward onto
 * the confirmed row when it settles. It exists for exactly one reason, and it is
 * a visible one: the list keys on it, so the React element that rendered the
 * pending bubble is the *same* element that renders the confirmed one.
 *
 * Without it, settlement changes the row's id from `pending-…` to a uuid, the
 * key changes, and FlatList unmounts one component and mounts another. Seen on a
 * 30fps screen recording of a real send: the bubble appeared, vanished for two
 * frames, and then replayed the whole squash-and-stretch launch. The animation
 * was correct both times, it simply ran twice, with a hole in the middle,
 * because as far as React was concerned two different messages had arrived.
 *
 * It is never read from Postgres and never written to it.
 */
export type TranscriptMessage = Message & {
  localKey?: string;
  /**
   * The picked photo's local uri, set only on an optimistic image row so the
   * bubble can show the pick before it is in the bucket. Dropped when the row
   * settles, at which point the bubble re-resolves through a signed URL.
   */
  localImageUri?: string;
  /**
   * The send failed and the bubble is STAYING, with a retry affordance.
   *
   * Set instead of removing the row. Deleting the bubble on failure was the old
   * behaviour (`settleOptimistic(..., null)`) and it is the worst of the
   * options: the member watches what they wrote disappear, learns the app eats
   * messages, and has to retype it. Telegram keeps the row at
   * `MESSAGE_SEND_STATE_SEND_ERROR` with a tap-to-retry mark
   * (MessageObject.java:135) and so do we.
   */
  failed?: boolean;
};

/** Marks a locally-created row that the server has not yet confirmed. */
export const PENDING_PREFIX = 'pending-';

export function isPending(message: TranscriptMessage): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

/**
 * Mark a pending row as failed, keeping it in place.
 *
 * The counterpart to `settleOptimistic(list, id, confirmed)`. That function
 * still removes the row when handed `null`, because two callers legitimately
 * want a withdrawal — a voice upload that never produced an object has nothing
 * to retry — but the text and media SEND failures now land here instead.
 */
export function markFailed(
  list: readonly TranscriptMessage[],
  pendingId: string,
): TranscriptMessage[] {
  return list.map(row =>
    row.id === pendingId ? { ...row, failed: true } : row,
  );
}

/** Newest-first insertion point for `created_at`. */
function insertAt(list: readonly TranscriptMessage[], createdAt: string): number {
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (row !== undefined && row.created_at <= createdAt) {
      return i;
    }
  }
  return list.length;
}

/**
 * Fold a server-confirmed message into the transcript.
 *
 * `selfId` is the session's own profile id: a confirmed row from this session is
 * the settlement of an optimistic one, not a new message.
 */
export function mergeIncoming(
  list: readonly TranscriptMessage[],
  incoming: Message,
  selfId: string | undefined,
): TranscriptMessage[] {
  const existing = list.findIndex(m => m.id === incoming.id);
  if (existing !== -1) {
    const next = [...list];
    // Preserve `localKey`. An update to a row already in the list must not
    // change its identity, and this branch is reached in the interleaving the
    // reconciliation exists for: Realtime settles the optimistic row first, then
    // the RPC response arrives for the same id. Overwriting with the bare server
    // row dropped the key and remounted the bubble on the *second* path, the
    // same replayed animation, one code path further along.
    next[existing] = { ...incoming, localKey: list[existing]?.localKey };
    return next;
  }

  if (incoming.sender_id === selfId) {
    // Oldest pending first, so two identical messages sent in a row settle in
    // the order they were composed.
    let match = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const row = list[i];
      if (row !== undefined && isPending(row) && row.body === incoming.body) {
        match = i;
        break;
      }
    }
    if (match !== -1) {
      const next = [...list];
      // Carry the optimistic id forward so the row keeps its identity, see the
      // note on TranscriptMessage. Without this the send animation plays twice.
      next[match] = { ...incoming, localKey: list[match]?.localKey ?? list[match]?.id };
      return next;
    }
  }

  const next = [...list];
  next.splice(insertAt(list, incoming.created_at), 0, incoming);
  return next;
}

/** Optimistic rows always go to the head, they are, by definition, newest. */
export function insertOptimistic(
  list: readonly TranscriptMessage[],
  optimistic: Message,
): TranscriptMessage[] {
  // A retry (tap-to-retry) or an outbox replay rebuilds the optimistic row with
  // the SAME pending-<nonce> id. Replace the existing row in place rather than
  // prepend a second one: a blind prepend leaves the failed row beside the
  // retried one (duplicate FlashList keys) and, after the resend confirms by a
  // different id, strands the original as a phantom "failed" bubble. Replacing
  // in place also keeps the replayed row at its original position, which the
  // preserved created_at is meant to guarantee. (2026-09-09 audit)
  const existing = list.findIndex(m => m.id === optimistic.id);
  if (existing !== -1) {
    const next = [...list];
    next[existing] = optimistic;
    return next;
  }
  return [optimistic, ...list];
}

/**
 * Settle an optimistic row once the RPC returns.
 *
 * `confirmed === null` means the send failed, so the row is withdrawn. If
 * Realtime already settled it, the pending row is gone and this is a no-op,
 * which is exactly why the id check comes first.
 */
export function settleOptimistic(
  list: readonly TranscriptMessage[],
  pendingId: string,
  confirmed: Message | null,
): TranscriptMessage[] {
  const index = list.findIndex(m => m.id === pendingId);
  if (index === -1) {
    return confirmed === null ? [...list] : mergeIncoming(list, confirmed, confirmed.sender_id);
  }
  const next = [...list];
  if (confirmed === null) {
    next.splice(index, 1);
    return next;
  }
  // Guard the case where Realtime inserted the confirmed row separately.
  if (list.some(m => m.id === confirmed.id)) {
    next.splice(index, 1);
    return next;
  }
  next[index] = { ...confirmed, localKey: pendingId };
  return next;
}

/** A read receipt is an UPDATE, so it arrives for a row already in the list. */
export function applyReadReceipt(
  list: readonly TranscriptMessage[],
  id: string,
  readAt: string,
): TranscriptMessage[] {
  const index = list.findIndex(m => m.id === id);
  if (index === -1) {
    return [...list];
  }
  const row = list[index];
  if (row === undefined || row.read_at !== null) {
    return [...list];
  }
  const next = [...list];
  next[index] = { ...row, read_at: readAt };
  return next;
}

/**
 * Ids of the peer's unread messages, for the read-receipt write-back.
 *
 * Only the recipient may set `read_at`, the RLS policy on `messages` forbids
 * marking your own message read, so filtering by sender here is not merely an
 * optimisation, it is what keeps the update from being rejected.
 */
export function unreadFromPeer(
  list: readonly TranscriptMessage[],
  selfId: string | undefined,
): string[] {
  if (selfId === undefined) {
    return [];
  }
  return list
    .filter(m => m.sender_id !== selfId && m.read_at === null && !isPending(m))
    .map(m => m.id);
}

/** The newest message this session sent, which is the one that shows a receipt. */
export function lastOwnMessageId(
  list: readonly TranscriptMessage[],
  selfId: string | undefined,
): string | undefined {
  if (selfId === undefined) {
    return undefined;
  }
  return list.find(m => m.sender_id === selfId)?.id;
}
