/**
 * Persistent, per-user cache of private conversation labels ("rename chat").
 *
 * The label map lives in the TanStack cache while the app is open but is
 * unavailable to the headless FCM background handler (no QueryClient there).
 * This module writes the same labels to MMKV so both the background handler
 * and the foreground push listener can substitute a label for the sender's
 * real display name before the notification is drawn.
 *
 * Two indexes are stored:
 *   conv-labels-conv-{userId}  conversationId → custom label
 *   conv-labels-peer-{userId}  peerId → custom label (derived when the
 *                              conversation_summaries row is available)
 *
 * The peer index is needed for incoming-call pushes, which carry only
 * `peerId` in the FCM payload and no `conversationId`.
 *
 * All reads and writes are synchronous (MMKV is memory-mapped); they are safe
 * to call from a headless JS context.
 */

import { storage } from './storage';

// ---------------------------------------------------------------------------
// Private key helpers
// ---------------------------------------------------------------------------

function convKey(userId: string): string {
  return `conv-labels-conv-${userId}`;
}

function peerKey(userId: string): string {
  return `conv-labels-peer-${userId}`;
}

function readRecord(key: string): Record<string, string> {
  const raw = storage.get(key);
  if (raw === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // Corrupted entry — treat as empty rather than crashing a push handler.
  }
  return {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The private label for `conversationId`, or `null` when none has been set.
 *
 * @param userId   The signed-in account's user id.
 * @param conversationId  The conversation being notified.
 */
export function getLabel(userId: string, conversationId: string): string | null {
  return readRecord(convKey(userId))[conversationId] ?? null;
}

/**
 * The private label keyed by peer user id (used for call pushes that carry no
 * `conversationId`), or `null` when none has been set.
 *
 * @param userId  The signed-in account's user id.
 * @param peerId  The caller's user id from the FCM payload.
 */
export function getLabelByPeer(userId: string, peerId: string): string | null {
  return readRecord(peerKey(userId))[peerId] ?? null;
}

/**
 * Persist the full label set fetched from the server.
 *
 * Call this whenever `useConversationLabels`' queryFn resolves with the latest
 * map. Supplying `peerUpdates` also updates the secondary index so call
 * pushes can look up the label by peer id.
 *
 * The peer index is MERGED, never replaced: `peerUpdates` covers only the
 * peers whose conversations are in the loaded inbox, so a replace dropped
 * every label for a chat outside it (not loaded, paginated out, ended), and a
 * call from that peer pushed the real name again (B-BS-3, AI review 10-03).
 * A null value clears that peer: their conversation is loaded and unlabelled.
 *
 * @param userId          The signed-in account's user id.
 * @param byConversation  The full conversationId → label map from the server.
 * @param peerUpdates     Optional peerId → label (or null to clear) for the
 *                        peers in the loaded conversation_summaries.
 */
export function setAllLabels(
  userId: string,
  byConversation: Map<string, string>,
  peerUpdates?: Map<string, string | null>,
): void {
  const convRecord: Record<string, string> = {};
  for (const [id, name] of byConversation) {
    convRecord[id] = name;
  }
  storage.set(convKey(userId), JSON.stringify(convRecord));

  if (peerUpdates !== undefined) {
    const peerRecord = readRecord(peerKey(userId));
    for (const [peerId, name] of peerUpdates) {
      if (name === null) {
        delete peerRecord[peerId];
      } else {
        peerRecord[peerId] = name;
      }
    }
    storage.set(peerKey(userId), JSON.stringify(peerRecord));
  }
}

/**
 * Update or clear a single conversation's label without overwriting others.
 *
 * Call this immediately in `useSetConversationName`'s onSuccess so the cache
 * reflects the change before the server round-trip finishes.
 *
 * @param name  The new label, or an empty string / null to clear it.
 */
export function setLabel(
  userId: string,
  conversationId: string,
  name: string | null,
): void {
  const map = readRecord(convKey(userId));
  if (name === null || name === '') {
    delete map[conversationId];
  } else {
    map[conversationId] = name;
  }
  storage.set(convKey(userId), JSON.stringify(map));
}

/**
 * Update or clear a single peer's label without overwriting others.
 *
 * @param name  The new label, or an empty string / null to clear it.
 */
export function setPeerLabel(
  userId: string,
  peerId: string,
  name: string | null,
): void {
  const map = readRecord(peerKey(userId));
  if (name === null || name === '') {
    delete map[peerId];
  } else {
    map[peerId] = name;
  }
  storage.set(peerKey(userId), JSON.stringify(map));
}

/**
 * Remove all cached labels for `userId`.
 *
 * Call this on sign-out, before the session is erased, so another account on
 * the same device never sees a previous user's private labels.
 */
export function clearLabels(userId: string): void {
  storage.remove(convKey(userId));
  storage.remove(peerKey(userId));
}
