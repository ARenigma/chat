/**
 * The send queue that survives the app dying.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Telegram writes an outgoing message into `messages_v2` with `send_state = 1`
 * and a negative `mid` BEFORE the network request goes out, and replays every
 * such row at the next cold launch — `checkUnsentMessages()` →
 * `getUnsentMessages(1000)` (ApplicationLoader.java:259,
 * MessagesStorage.java:8596). A process kill between "tapped send" and "server
 * acknowledged" therefore loses nothing.
 *
 * Ours lost everything. The optimistic row lived only in the React Query cache
 * (`chat.ts`), so a kill mid-send dropped the message with no trace, and a
 * failed send deleted the bubble outright. Both are fixed by persisting the
 * intent before the request and replaying it after.
 *
 * ---------------------------------------------------------------------------
 * Scope: TEXT ONLY, deliberately
 * ---------------------------------------------------------------------------
 * Voice notes and images are not queued here, and that is a decision rather
 * than an omission. Their send references an object already uploaded to a
 * bucket, and the local recording sits in a cache directory Android is free to
 * clear. Replaying one after a kill could post a message pointing at a file
 * that no longer exists on either side. Telegram can replay media because it
 * copies it into storage it owns first; we do not, so queueing media would be
 * a promise this module cannot keep. Media sends still keep their bubble and
 * show as failed — they just are not resurrected across a launch.
 *
 * ---------------------------------------------------------------------------
 * Why MMKV and not SQLite
 * ---------------------------------------------------------------------------
 * MMKV is already a dependency. A queue of a few dozen short strings does not
 * justify a native SQLite dependency under RULE 5 — and the thing that makes
 * Telegram's outbox correct is not SQL, it is persist-before-send plus an
 * idempotency key. We have both.
 *
 * This module is PURE and imports nothing from `react-native`, so it is
 * testable — the same rule `bloom.ts` and `onboarding.ts` follow, and the
 * reason the MMKV half lives in `outboxStore.ts`. An earlier draft kept both
 * here and claimed to be testable while importing MMKV two lines down, which
 * jest cannot load at all.
 */


/**
 * The cap, and why there is one.
 *
 * An outbox is written on every send and drained on success, so it is normally
 * empty or nearly so. It only grows when sends are failing — offline, or a
 * server refusing — which is exactly when a runaway would do damage: an
 * unbounded queue would replay hundreds of messages the moment connectivity
 * returned, which is worse for the recipient than losing the tail. Oldest wins
 * on overflow: the first thing someone said is the thing they most meant to
 * send.
 */
export const OUTBOX_LIMIT = 50;

/** One queued text send. */
export interface OutboxEntry {
  /**
   * The idempotency key from migration 081, and the local row's id.
   *
   * The whole point of persisting it: a replay carries the SAME nonce, so
   * `send_message_idempotent` collapses it if the original in fact landed. That
   * is what makes replay safe rather than a duplicate generator — Telegram's
   * `random_id` reuse (SendMessagesHelper.java:1868) by another name.
   */
  readonly nonce: string;
  readonly conversationId: string;
  readonly body: string;
  readonly replyToId: string | null;
  /** ISO, so a replayed bubble sorts where it was written, not where it landed. */
  readonly createdAt: string;
  /** How many times a send of this entry has been attempted. */
  readonly attempts: number;
}

// ─── Pure list operations ────────────────────────────────────────────────────

/** Add or replace by nonce, oldest-first, bounded. */
export function withEntry(
  list: readonly OutboxEntry[],
  entry: OutboxEntry,
): OutboxEntry[] {
  const without = list.filter(e => e.nonce !== entry.nonce);
  const next = [...without, entry];
  // Drop from the FRONT on overflow: see OUTBOX_LIMIT. `slice` from the end
  // keeps the newest, which is the opposite of what that note argues, so this
  // keeps the oldest and discards what would not fit.
  return next.length <= OUTBOX_LIMIT ? next : next.slice(0, OUTBOX_LIMIT);
}

export function withoutEntry(
  list: readonly OutboxEntry[],
  nonce: string,
): OutboxEntry[] {
  return list.filter(e => e.nonce !== nonce);
}

/** Bump the attempt counter, leaving everything else alone. */
export function withAttempt(
  list: readonly OutboxEntry[],
  nonce: string,
): OutboxEntry[] {
  return list.map(e =>
    e.nonce === nonce ? { ...e, attempts: e.attempts + 1 } : e,
  );
}

export function forConversation(
  list: readonly OutboxEntry[],
  conversationId: string,
): OutboxEntry[] {
  return list.filter(e => e.conversationId === conversationId);
}

/**
 * The age past which a queued entry is abandoned.
 *
 * Replay runs on ChatScreen mount for that entry's conversation, so an entry
 * whose conversation is never reopened (deleted, or simply never revisited)
 * would otherwise sit in MMKV forever. A week is well past any plausible offline
 * window; a text this stale is better dropped than resurrected into a thread
 * nobody is looking at.
 */
export const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Drop entries older than `ttlMs`, measured from `createdAt`. */
export function withoutExpired(
  list: readonly OutboxEntry[],
  nowMs: number,
  ttlMs: number = OUTBOX_TTL_MS,
): OutboxEntry[] {
  return list.filter(e => {
    const t = Date.parse(e.createdAt);
    // An unparseable timestamp is itself reason enough to drop the entry.
    return Number.isFinite(t) && nowMs - t < ttlMs;
  });
}

/**
 * Validate one decoded entry.
 *
 * Storage is not a trusted input: it survives upgrades, and a shape written by
 * an older build must not crash this one. Anything unrecognised is dropped
 * rather than repaired — a half-understood queued message is not worth sending.
 */
function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.nonce === 'string' &&
    typeof e.conversationId === 'string' &&
    typeof e.body === 'string' &&
    (typeof e.replyToId === 'string' || e.replyToId === null) &&
    typeof e.createdAt === 'string' &&
    typeof e.attempts === 'number'
  );
}

/** Decode a stored payload, discarding anything malformed. */
export function decode(raw: string | null | undefined): OutboxEntry[] {
  if (raw === undefined || raw === null || raw === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    // Corrupt JSON means an empty outbox, never a throw at boot. A message
    // nobody can read is already lost; taking the app down with it is worse.
    return [];
  }
}
