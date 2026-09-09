/**
 * The MMKV half of the outbox.
 *
 * Split from `outbox.ts` so the list logic there stays importable under jest:
 * `react-native-mmkv` ships ESM that jest cannot parse, so ANY module importing
 * it is untestable, and a pure module that imports it is only nominally pure.
 *
 * Everything here is a thin read-modify-write over the pure functions. There is
 * deliberately no logic in this file — logic that cannot be tested is logic
 * that will be wrong.
 */

import { storage } from './storage';
import {
  decode,
  forConversation,
  withAttempt,
  withEntry,
  withoutEntry,
  withoutExpired,
  type OutboxEntry,
} from './outbox';

const KEY = 'companion.outbox.v1';

export function readOutbox(): OutboxEntry[] {
  return decode(storage.get(KEY));
}

function writeOutbox(list: readonly OutboxEntry[]): void {
  if (list.length === 0) {
    // Remove rather than store "[]", so an empty outbox leaves no key behind.
    storage.remove(KEY);
    return;
  }
  storage.set(KEY, JSON.stringify(list));
}

/** Persist an intent to send. Called BEFORE the request, which is the point. */
export function enqueue(entry: OutboxEntry): void {
  writeOutbox(withEntry(readOutbox(), entry));
}

/** The send landed (or was deduped, which is the same outcome). Forget it. */
export function dequeue(nonce: string): void {
  writeOutbox(withoutEntry(readOutbox(), nonce));
}

export function recordAttempt(nonce: string): void {
  writeOutbox(withAttempt(readOutbox(), nonce));
}

export function pendingFor(conversationId: string): OutboxEntry[] {
  return forConversation(readOutbox(), conversationId);
}

/**
 * Drop entries older than the TTL. Called once at boot: replay is per-conversation
 * (on ChatScreen mount), so an entry for a conversation never reopened would
 * otherwise never be collected. Writes only when something was actually removed.
 */
export function sweepExpiredOutbox(): void {
  const list = readOutbox();
  const kept = withoutExpired(list, Date.now());
  if (kept.length !== list.length) {
    writeOutbox(kept);
  }
}
