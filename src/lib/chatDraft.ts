/**
 * Draft persistence for one chat: the composer's typed text, kept across an
 * AppState backgrounding so an OS process kill while backgrounded does not
 * read as data loss (2026-09-17 audit, X6 — Amit's own rule: the draft
 * survives backgrounding, and is purged only on an intentional exit from the
 * chat — back to Home, into a call, or the app closing).
 *
 * The armed reply target is deliberately NOT part of this: the chat screen's own
 * `replyTo` has carried "never persisted: a half-composed reply is not worth
 * surviving a screen" since before this audit, and X6 only asked for the
 * typed text — extending persistence to the reply target too would be a
 * second, unasked decision layered onto Amit's actual one.
 *
 * A thin MMKV shell, no logic — same split as `outboxStore.ts` and for the
 * same reason: `react-native-mmkv` ships ESM that jest cannot parse, so
 * nothing here is unit-tested directly.
 */
import { storage } from './storage';

const TEXT_PREFIX = 'companion.draft.text.';

export function readDraftText(conversationId: string): string {
  return storage.get(TEXT_PREFIX + conversationId) ?? '';
}

export function writeDraftText(conversationId: string, text: string): void {
  if (text === '') {
    storage.remove(TEXT_PREFIX + conversationId);
    return;
  }
  storage.set(TEXT_PREFIX + conversationId, text);
}

/** The intentional-exit path (back to Home, into a call) — not the background path. */
export function clearChatDraft(conversationId: string): void {
  storage.remove(TEXT_PREFIX + conversationId);
}
