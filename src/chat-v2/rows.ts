/**
 * The V2 transcript's row model.
 *
 * Pure on purpose, and separate from `useChatV2Controller` for the reason
 * `src/lib/transcript.ts` is separate from `src/api/chat.ts`: this is the part
 * with the rules in it — merge order, day boundaries, run breaks, the unread
 * divider's position — and it is testable without booting the native runtime
 * or a query client.
 *
 * It deliberately re-implements nothing. `opensDay`, `voiceOf`, `imageOf`,
 * `sessionEndedLabel` and `unreadFromPeer` are the app's shared helpers, so
 * the transcript, the inbox and the history list cannot disagree about a day
 * divider or a voice payload. What it does NOT take from anywhere is the row
 * TYPE: it is declared here, in a module that imports no view, which is what
 * lets `MediaViewer` take `ChatV2ImageBody` from it without a cycle.
 *
 * Conventions, stated once because every consumer depends on them:
 *   - rows are NEWEST FIRST, which is what an `inverted` FlashList wants;
 *   - `id` is the STABLE RECYCLE KEY, not the message id — a settled row keeps
 *     the `localKey` its optimistic bubble had, so the confirmation does not
 *     remount the cell (see `TranscriptMessage.localKey`);
 *   - `sortAt` is the single timeline stamp every kind is merged on.
 */
import type { IconName } from '../components/Icon';
import type { CallRecord } from '../api/chat';
import type { SessionEvent } from '../api/sessions';
import type { ConversationSummary } from '../lib/database.types';
import { imageOf } from '../lib/attachments';
import { opensDay } from '../lib/datetime';
import {
  MESSAGE_PAGE_SIZE,
  isPending,
  sessionEndedLabel,
  unreadFromPeer,
  type TranscriptMessage,
} from '../lib/transcript';
import { voiceOf } from '../lib/voice';

/** A voice note, resolved once per data change so the cell prop stays stable. */
export interface ChatV2VoiceBody {
  messageId: string;
  path: string;
  durationMs: number;
  peaks?: number[];
}

/** A photo, with the optimistic local uri while the upload is in flight. */
export interface ChatV2ImageBody {
  messageId: string;
  path: string;
  width: number;
  height: number;
  localUri?: string;
}

/**
 * The quoted parent of a reply, resolved against the loaded page.
 *
 * `body` is null on a voice note, and the cell renders that as a KIND rather
 * than as an empty line. A parent that is not in the page produces no quote at
 * all: a preview that says nothing is worse than no preview.
 */
interface ChatV2Quote {
  author: string;
  body: string | null;
}

export interface ChatV2MessageRow {
  kind: 'message';
  id: string;
  sortAt: string;
  message: TranscriptMessage;
  mine: boolean;
  /** Set when this row replies to another one still in the loaded page. */
  quote?: ChatV2Quote;
  /** Oldest bubble of a visual run: carries the tail. */
  first: boolean;
  /** Newest bubble of a visual run. */
  last: boolean;
  opensDay: boolean;
  pending: boolean;
  failed: boolean;
  deleted: boolean;
  voice?: ChatV2VoiceBody;
  image?: ChatV2ImageBody;
}

interface ChatV2CallRow {
  kind: 'call';
  id: string;
  sortAt: string;
  call: CallRecord;
  opensDay: boolean;
}

/** A centered notice — a session boundary or an ephemeral confirmation. */
interface ChatV2SystemRow {
  kind: 'system';
  id: string;
  sortAt: string;
  text: string;
  /**
   * WhatsApp's two system inks (Amit, 2026-10-03): a session boundary reads
   * green, a notice about the chat (notified, joined, a refusal) reads yellow.
   */
  tone: 'session' | 'notice';
  icon?: IconName;
  /** A literal emoji, for the one mark that is an emoji rather than a glyph. */
  emoji?: string;
  opensDay: boolean;
}

interface ChatV2DividerRow {
  kind: 'divider';
  id: 'unread-divider';
  sortAt: string;
  opensDay: false;
}

export type ChatV2Row =
  | ChatV2MessageRow
  | ChatV2CallRow
  | ChatV2SystemRow
  | ChatV2DividerRow;

/** A client-only row: no database row backs it, and it is not history. */
export interface ChatV2Notice {
  at: string;
  text: string;
  icon?: IconName;
}

export interface ChatV2RowInput {
  /** Newest first, as `useMessages` returns it. */
  readonly messages: readonly TranscriptMessage[] | undefined;
  readonly calls: readonly CallRecord[] | undefined;
  readonly sessionEvents: readonly SessionEvent[] | undefined;
  readonly selfId: string | undefined;
  /**
   * The row key the "Unread messages" divider sits under, snapshotted once per
   * conversation by the controller. Null when there was nothing unread.
   */
  readonly unreadAnchorId: string | null;
  readonly notice: ChatV2Notice | null;
  /** Names the other side of a quoted reply. Blank until identity resolves. */
  readonly peerName?: string;
}

/** The centred pill's id, so the controller and the cell agree on one string. */
const CHAT_V2_NOTICE_ID = 'chat-v2-notice';

/**
 * What a deleted message says to each side of it. The author is told what THEY
 * did; the other person is told only that something was taken back, which is
 * already obvious from the side the bubble is on.
 */
function chatV2TombstoneText(mine: boolean): string {
  return mine ? 'You deleted this message' : 'This message was deleted';
}

/**
 * The string a message cell shows.
 *
 * The tombstone is checked FIRST: migration 103 nulls every payload column
 * together, so a deleted voice note has no `voice_path` and would otherwise
 * claim a recording that is gone.
 */
export function chatV2MessageText(row: ChatV2MessageRow): string {
  if (row.deleted) {
    return chatV2TombstoneText(row.mine);
  }
  return row.message.body ?? (row.image !== undefined ? 'Photo' : 'Voice note');
}

/**
 * The quoted parent of a reply, or nothing.
 *
 * "You" for my own message rather than my display name, which is what both
 * reference clients do: a quote is read by the person looking at it, and the
 * second person is the one they are.
 */
function quoteOf(
  message: TranscriptMessage,
  byId: ReadonlyMap<string, TranscriptMessage>,
  selfId: string | undefined,
  peerName: string,
): ChatV2Quote | undefined {
  if (message.reply_to_id === null) {
    return undefined;
  }
  const parent = byId.get(message.reply_to_id);
  if (parent === undefined) {
    return undefined;
  }
  return {
    author: parent.sender_id === selfId ? 'You' : peerName,
    // Null on a voice note, which the cell renders as a kind. A deleted parent
    // has no body either, and saying nothing about it is the honest preview.
    body:
      parent.deleted_at !== null
        ? null
        : parent.body ?? (imageOf(parent) !== null ? 'Photo' : null),
  };
}

/** Which send path a failed row has to be replayed through. */
export type ChatV2RetryKind = 'none' | 'text' | 'image' | 'voice';

/**
 * Route a retry by the payload the row actually carries.
 *
 * Media FIRST, and that ordering is the fix rather than a preference. The
 * body-first ladder this replaces sent any failed row with a body through the
 * TEXT path, so a voice note or a photo that carried a caption would have been
 * replayed as a plain message — under the same nonce, which
 * `send_message_idempotent` collapses, so the recording would have been lost
 * rather than retried. `voice`/`image` are set by `voiceOf`/`imageOf`, which
 * only resolve when the object really exists.
 *
 * A row whose UPLOAD never completed was withdrawn rather than kept, so it
 * never reaches here; `none` covers a healthy row and a failed row with no
 * payload at all.
 */
export function chatV2RetryKind(row: ChatV2MessageRow): ChatV2RetryKind {
  if (!row.failed) {
    return 'none';
  }
  if (row.voice !== undefined) {
    return 'voice';
  }
  if (row.image !== undefined) {
    return 'image';
  }
  return row.message.body === null ? 'none' : 'text';
}

/**
 * One recycle pool per cell shape.
 *
 * Message rows split further: a text bubble, a voice row and a media card share
 * nothing in height or subtree, so one pool would hand a recycled voice cell to
 * a text message and jump.
 */
export function chatV2ItemType(row: ChatV2Row): string {
  return row.opensDay ? `${cellShape(row)}-day` : cellShape(row);
}

/**
 * The day header is part of the item type, because it is part of the CELL.
 *
 * `ChatListV2` renders the divider inside the row's own wrapper, so a row that
 * opens a day is a taller subtree with an extra child. FlashList hands a
 * recycled cell to the next item of the same type; recycling a day-opening cell
 * into one that opens no day would leave the divider's height in place for a
 * frame and jump the list.
 * https://shopify.github.io/flash-list/docs/guides/performant-components
 */
function cellShape(row: ChatV2Row): string {
  if (row.kind !== 'message') {
    return row.kind;
  }
  if (row.voice !== undefined) {
    return 'message-voice';
  }
  if (row.image !== undefined) {
    return 'message-media';
  }
  return 'message-text';
}

/**
 * Merge every source into one newest-first timeline.
 *
 * Day boundaries and run breaks are computed AFTER the merge, against each
 * row's true older neighbour whatever its kind. Computing them against adjacent
 * messages alone is the V1 defect this ordering fixes: a call or a session
 * boundary between two days swallowed the divider, and a bubble sent a week
 * after the one below it kept its neighbour's run.
 */
export function buildChatV2Rows(input: ChatV2RowInput): ChatV2Row[] {
  const {
    messages,
    calls,
    sessionEvents,
    selfId,
    unreadAnchorId,
    notice,
    peerName = '',
  } = input;

  /*
   * The quote a reply shows, resolved against the page that is loaded.
   *
   * Built once as a map rather than searched per row: a hundred rows each
   * scanning a hundred messages is ten thousand comparisons on every receipt.
   */
  const byId = new Map<string, TranscriptMessage>();
  for (const m of messages ?? []) {
    byId.set(m.id, m);
  }

  const messageRows: ChatV2MessageRow[] = (messages ?? []).map(m => {
    const audio = voiceOf(m);
    const picture = imageOf(m);
    return {
      kind: 'message',
      id: m.localKey ?? m.id,
      sortAt: m.created_at,
      message: m,
      mine: m.sender_id === selfId,
      // Both recomputed in the single pass below, once the true neighbours are
      // known. Seeded here so the shape is complete.
      first: false,
      last: false,
      opensDay: false,
      pending: isPending(m),
      failed: m.failed === true,
      deleted: m.deleted_at !== null,
      quote: quoteOf(m, byId, selfId, peerName),
      // Built here rather than in `renderItem` so the identity is stable across
      // renders and the memo on the cell still holds.
      voice:
        audio === null
          ? undefined
          : {
              messageId: m.id,
              path: audio.path,
              durationMs: audio.durationMs,
              peaks: audio.peaks ?? undefined,
            },
      image:
        picture === null
          ? undefined
          : {
              messageId: m.id,
              path: picture.path,
              width: picture.width,
              height: picture.height,
              localUri: m.localImageUri,
            },
    };
  });

  /*
   * The oldest message the page holds, when the page is FULL.
   *
   * `useMessages` fetches one page of `MESSAGE_PAGE_SIZE`, so a full page means
   * older messages exist that nobody has loaded. Calls and session boundaries
   * are fetched on their own (a call list is not paginated against the
   * transcript), so without this a call from six months ago lands below the
   * oldest bubble on screen — beneath a stretch of conversation that simply is
   * not there — and then jumps the moment a gap page fills in around it.
   *
   * Undefined when the page is short, which is the common case: everything is
   * loaded, so everything is in its true place.
   */
  const pageFloor =
    messages !== undefined && messages.length >= MESSAGE_PAGE_SIZE
      ? messages[messages.length - 1]?.created_at
      : undefined;
  const withinPage = (at: string): boolean =>
    pageFloor === undefined || at >= pageFloor;

  const callRows: ChatV2CallRow[] = (calls ?? [])
    .filter(c => withinPage(c.created_at))
    .map(c => ({
      kind: 'call',
      id: `call-${c.id}`,
      sortAt: c.created_at,
      call: c,
      opensDay: false,
    }));

  /*
   * Ended CHAT sessions only. A call already produces its own row from the
   * `calls` table, carrying outcomes a session row cannot express (a declined
   * call has no `paid_sessions` row at all), so feeding call sessions in here
   * as well would print every connected call twice.
   */
  const sessionRows: ChatV2SystemRow[] = (sessionEvents ?? [])
    .filter(e => withinPage(e.ended_at))
    .map(e => ({
      kind: 'system',
      id: `session-${e.id}`,
      sortAt: e.ended_at,
      text: sessionEndedLabel(e.minutes_billed, e.ended_at, e.started_at ?? undefined),
      tone: 'session',
      emoji: '🧡',
      opensDay: false,
    }));

  const noticeRows: ChatV2SystemRow[] =
    notice === null
      ? []
      : [
          {
            kind: 'system',
            id: CHAT_V2_NOTICE_ID,
            sortAt: notice.at,
            text: notice.text,
            tone: 'notice',
            icon: notice.icon,
            opensDay: false,
          },
        ];

  const sorted: ChatV2Row[] = [
    ...messageRows,
    ...callRows,
    ...sessionRows,
    ...noticeRows,
  ].sort((a, b) => Date.parse(b.sortAt) - Date.parse(a.sortAt));

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    const older = sorted[i + 1];
    if (row === undefined) {
      continue;
    }
    row.opensDay = opensDay(
      { created_at: row.sortAt },
      older === undefined ? undefined : { created_at: older.sortAt },
    );
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const row = sorted[i];
    if (row === undefined || row.kind !== 'message') {
      continue;
    }
    const older = sorted[i + 1];
    const newer = sorted[i - 1];
    row.first =
      older === undefined ||
      older.kind !== 'message' ||
      older.message.sender_id !== row.message.sender_id ||
      // The divider belongs to the row it opens, so a row that opens a day is
      // always the start of a run.
      row.opensDay;
    row.last =
      newer === undefined ||
      newer.kind !== 'message' ||
      newer.message.sender_id !== row.message.sender_id ||
      // ...and the row below a divider closes the run it was in.
      newer.opensDay;
  }

  /*
   * Spliced by explicit index, after every pass above that assumes a
   * message-only neighbour — the divider is not a message and must not
   * participate in either. Position by index rather than by `sortAt` so it
   * stays put however the comparator breaks ties on equal timestamps.
   */
  if (unreadAnchorId !== null) {
    const anchorIndex = sorted.findIndex(r => r.id === unreadAnchorId);
    const anchor = anchorIndex === -1 ? undefined : sorted[anchorIndex];
    if (anchor !== undefined) {
      sorted.splice(anchorIndex + 1, 0, {
        kind: 'divider',
        id: 'unread-divider',
        sortAt: anchor.sortAt,
        opensDay: false,
      });
    }
  }

  return sorted;
}

export interface ChatV2Conversation {
  /** The summary row for this peer, when the conversation list holds one. */
  knownThread: ConversationSummary | undefined;
  /**
   * Whether `open_conversation` has to run to create the thread. False until
   * the conversation list has loaded — see the note on the resolver.
   */
  needsOpen: boolean;
  conversationId: string | undefined;
  /** Which side of the thread we are on. Not `profiles.role`. */
  isMemberSide: boolean;
}

/**
 * Which conversation this screen is showing, and which side of it we are on.
 *
 * `open_conversation` takes a PROVIDER id and raises for anything else, and the
 * provider tree opens this screen with a MEMBER's profile id — so the RPC is
 * only ever the right question for a thread that does not exist yet. A thread
 * already in the cached list short-circuits it, which is what makes reopening a
 * chat one round trip (messages) instead of two, and keeps the provider side
 * correct for free: a provider only ever reaches threads they are already in.
 *
 * WHICH IS WHY `needsOpen` WAITS FOR THE LIST. While `threads` is `undefined`
 * nobody knows whether the thread exists, and "not found in a list I do not
 * have" is not an answer. Asking anyway costs a provider a guaranteed failure
 * on every cold open — the RPC rejects a member id before it writes anything —
 * and costs a member a request that races the list already on its way back.
 * One extra frame before the first fetch is the whole price.
 *
 * `i_am_member` is the authoritative side, because a member admitted as a
 * provider keeps the threads they paid for. It defaults to the member side when
 * there is no thread yet: a brand-new conversation is always opened by a member
 * from the directory.
 */
export function resolveChatV2Conversation(
  threads: readonly ConversationSummary[] | undefined,
  providerId: string,
  openedId: string | undefined,
): ChatV2Conversation {
  const knownThread = threads?.find(t => t.peer_id === providerId);
  return {
    knownThread,
    needsOpen: threads !== undefined && knownThread === undefined,
    conversationId: knownThread?.conversation_id ?? openedId,
    isMemberSide: knownThread?.i_am_member ?? true,
  };
}

/**
 * The row key the unread divider anchors to: the OLDEST message from the peer
 * that was unread when the screen opened.
 *
 * Snapshotted once per conversation by the caller rather than recomputed from
 * live data — read receipts are viewport-gated, so messages keep arriving at
 * `read_at !== null` as they scroll into view, and a live recomputation would
 * make the divider retreat and vanish while the member reads it.
 */
export function unreadAnchorOf(
  messages: readonly TranscriptMessage[] | undefined,
  selfId: string | undefined,
): string | null {
  if (messages === undefined || selfId === undefined) {
    return null;
  }
  const unread = new Set(unreadFromPeer(messages, selfId));
  let oldest: TranscriptMessage | undefined;
  for (const m of messages) {
    if (
      unread.has(m.id) &&
      (oldest === undefined || m.created_at < oldest.created_at)
    ) {
      oldest = m;
    }
  }
  return oldest === undefined ? null : oldest.localKey ?? oldest.id;
}

/** How far back the contact guard's hard window looks (spec 3.5: 6 messages / 15 min). */
export const CONTACT_WINDOW_MS = 15 * 60 * 1000;
/** The window's earlier messages; the one being sent is the sixth. */
const CONTACT_WINDOW_PRIOR = 5;

/**
 * The sender's own recent text bodies, OLDEST FIRST, for the composer's
 * contact-guard precheck (`precheckContactGuard`'s `recentOwn`).
 *
 * The server's window reads stored messages, so only what the server holds
 * counts: a pending bubble has not reached it, a failed one never did, and a
 * deleted one has no body left. Voice notes and photos carry no text.
 */
export function chatV2RecentOwnTexts(
  rows: readonly ChatV2Row[],
  nowMs: number,
): string[] {
  const picked: string[] = [];
  // Rows are newest first, so the first five that qualify are the five newest.
  for (const row of rows) {
    if (picked.length === CONTACT_WINDOW_PRIOR) {
      break;
    }
    if (
      row.kind !== 'message' ||
      !row.mine ||
      row.pending ||
      row.failed ||
      row.deleted
    ) {
      continue;
    }
    const body = row.message.body;
    if (body === null || body.trim() === '') {
      continue;
    }
    const at = Date.parse(row.message.created_at);
    if (!Number.isFinite(at) || nowMs - at > CONTACT_WINDOW_MS) {
      // Older rows only get older from here.
      break;
    }
    picked.push(body);
  }
  return picked.reverse();
}
