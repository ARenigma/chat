/**
 * Conversation list chrome: pin, hide-from-rail, delete-from-lists.
 * Pure helpers so the store stays a persistence wrapper.
 */
export interface RailPrefs {
  pinned: readonly string[];
  hiddenFromRail: readonly string[];
  deleted: readonly string[];
}

export function isPinned(prefs: RailPrefs, peerId: string): boolean {
  return prefs.pinned.includes(peerId);
}

export function visibleOnRail(prefs: RailPrefs, peerId: string): boolean {
  return !prefs.deleted.includes(peerId) && !prefs.hiddenFromRail.includes(peerId);
}

export function visibleOnList(prefs: RailPrefs, peerId: string): boolean {
  return !prefs.deleted.includes(peerId);
}

/**
 * Pinned first, then any unread conversation, then most recent activity.
 *
 * The three-tier order Amit specified (2026-09-20):
 *   1. Pinned — the thread the provider explicitly bookmarked.
 *   2. Unread — any conversation with unread_count > 0, so outstanding messages
 *      float to the top without the user having to search.
 *   3. Recent — `last_session_at` descending, which is session-activity time.
 *
 * `at` is an ISO timestamp or empty. `unread` is the caller's own unread count.
 */
export function compareConversations(
  prefs: RailPrefs,
  a: { peerId: string; at: string; unread?: number },
  b: { peerId: string; at: string; unread?: number },
): number {
  const ap = prefs.pinned.includes(a.peerId) ? 1 : 0;
  const bp = prefs.pinned.includes(b.peerId) ? 1 : 0;
  if (ap !== bp) {
    return bp - ap;
  }
  // Within each pin tier, unread threads precede read ones.
  const au = (a.unread ?? 0) > 0 ? 1 : 0;
  const bu = (b.unread ?? 0) > 0 ? 1 : 0;
  if (au !== bu) {
    return bu - au;
  }
  return b.at.localeCompare(a.at);
}
