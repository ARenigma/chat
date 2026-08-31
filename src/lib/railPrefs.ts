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

/** Pinned first, then recency. `at` is an ISO timestamp or empty. */
export function compareConversations(
  prefs: RailPrefs,
  a: { peerId: string; at: string },
  b: { peerId: string; at: string },
): number {
  const ap = prefs.pinned.includes(a.peerId) ? 1 : 0;
  const bp = prefs.pinned.includes(b.peerId) ? 1 : 0;
  if (ap !== bp) {
    return bp - ap;
  }
  return b.at.localeCompare(a.at);
}
