/**
 * Transcript reconciliation — pure, so it can be tested without a socket.
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
 * The alternative — a client-generated nonce column — would need a schema change
 * and would still need the id-based idempotency below, so it buys nothing.
 */
import type { Message } from './database.types';

/** Marks a locally-created row that the server has not yet confirmed. */
export const PENDING_PREFIX = 'pending-';

export function isPending(message: Message): boolean {
  return message.id.startsWith(PENDING_PREFIX);
}

/** Newest-first insertion point for `created_at`. */
function insertAt(list: readonly Message[], createdAt: string): number {
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
  list: readonly Message[],
  incoming: Message,
  selfId: string | undefined,
): Message[] {
  const existing = list.findIndex(m => m.id === incoming.id);
  if (existing !== -1) {
    const next = [...list];
    next[existing] = incoming;
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
      next[match] = incoming;
      return next;
    }
  }

  const next = [...list];
  next.splice(insertAt(list, incoming.created_at), 0, incoming);
  return next;
}

/** Optimistic rows always go to the head — they are, by definition, newest. */
export function insertOptimistic(list: readonly Message[], optimistic: Message): Message[] {
  return [optimistic, ...list];
}

/**
 * Settle an optimistic row once the RPC returns.
 *
 * `confirmed === null` means the send failed, so the row is withdrawn. If
 * Realtime already settled it, the pending row is gone and this is a no-op —
 * which is exactly why the id check comes first.
 */
export function settleOptimistic(
  list: readonly Message[],
  pendingId: string,
  confirmed: Message | null,
): Message[] {
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
  next[index] = confirmed;
  return next;
}

/** A read receipt is an UPDATE, so it arrives for a row already in the list. */
export function applyReadReceipt(
  list: readonly Message[],
  id: string,
  readAt: string,
): Message[] {
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
 * Only the recipient may set `read_at` — the RLS policy on `messages` forbids
 * marking your own message read, so filtering by sender here is not merely an
 * optimisation, it is what keeps the update from being rejected.
 */
export function unreadFromPeer(list: readonly Message[], selfId: string | undefined): string[] {
  if (selfId === undefined) {
    return [];
  }
  return list
    .filter(m => m.sender_id !== selfId && m.read_at === null && !isPending(m))
    .map(m => m.id);
}

/** The newest message this session sent, which is the one that shows a receipt. */
export function lastOwnMessageId(
  list: readonly Message[],
  selfId: string | undefined,
): string | undefined {
  if (selfId === undefined) {
    return undefined;
  }
  return list.find(m => m.sender_id === selfId)?.id;
}
