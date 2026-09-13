import { timeOfDay } from '../src/lib/datetime';
import {
  PENDING_PREFIX,
  applyReadReceipt,
  insertOptimistic,
  sessionEndedLabel,
  isPending,
  lastOwnMessageId,
  mergeIncoming,
  settleOptimistic,
  unreadFromPeer,
} from '../src/lib/transcript';
import type { Message } from '../src/lib/database.types';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONVERSATION = 'cccccccc-0000-4000-8000-000000000003';

let seq = 0;

function message(overrides: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `id-${seq}`,
    conversation_id: CONVERSATION,
    sender_id: THEM,
    body: `body ${seq}`,
    // A text message, so the three 011 payload columns are all null. A voice note
    // is `body: null` with a `voice_path`; see the block at the end of this file
    // for the settlement cases that matter for one.
    reply_to_id: null,
    voice_path: null,
    voice_duration_ms: null,
    voice_peaks: null,
    attachment_path: null,
    attachment_type: null,
    attachment_width: null,
    attachment_height: null,
    session_id: null,
    origin: 'live',
    // Fixed base so ordering is deterministic and unrelated to test runtime.
    created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    read_at: null,
    ...overrides,
  };
}

function optimistic(body: string, at: number): Message {
  return message({
    id: `${PENDING_PREFIX}${at}`,
    sender_id: ME,
    body,
    created_at: new Date(1_700_000_000_000 + at).toISOString(),
  });
}

describe('mergeIncoming', () => {
  it('is idempotent: the same row twice does not duplicate', () => {
    const row = message();
    const once = mergeIncoming([], row, ME);
    const twice = mergeIncoming(once, row, ME);
    expect(twice).toHaveLength(1);
  });

  it('replaces in place when a row is redelivered with new fields', () => {
    const row = message();
    const list = mergeIncoming([], row, ME);
    const updated = { ...row, read_at: new Date().toISOString() };
    const merged = mergeIncoming(list, updated, ME);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.read_at).not.toBeNull();
  });

  it('keeps the list newest-first regardless of arrival order', () => {
    const older = message({ created_at: '2026-01-01T10:00:00.000Z' });
    const newer = message({ created_at: '2026-01-01T12:00:00.000Z' });
    const middle = message({ created_at: '2026-01-01T11:00:00.000Z' });

    let list: Message[] = [];
    for (const row of [newer, older, middle]) {
      list = mergeIncoming(list, row, ME);
    }
    expect(list.map(m => m.created_at)).toEqual([
      newer.created_at,
      middle.created_at,
      older.created_at,
    ]);
  });

  /**
   * The case the whole module exists for. A send produces an optimistic row and
   * two independent confirmations; if the Realtime INSERT is treated as a new
   * message the sender sees their own text twice.
   */
  it('settles an optimistic row when our own message arrives over the socket', () => {
    const pending = optimistic('are you there', 5_000);
    const list = insertOptimistic([], pending);

    const confirmed = message({ id: 'real-1', sender_id: ME, body: 'are you there' });
    const merged = mergeIncoming(list, confirmed, ME);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe('real-1');
    expect(merged.some(isPending)).toBe(false);
  });

  it('settles two identical messages in the order they were composed', () => {
    let list = insertOptimistic([], optimistic('same', 1_000));
    list = insertOptimistic(list, optimistic('same', 2_000));

    const first = message({ id: 'real-first', sender_id: ME, body: 'same' });
    list = mergeIncoming(list, first, ME);

    // The older pending row settles first, so the surviving pending one is the
    // message composed second, otherwise the timestamps would swap.
    expect(list.filter(isPending)).toHaveLength(1);
    expect(list.filter(isPending)[0]?.id).toBe(`${PENDING_PREFIX}2000`);

    const second = message({ id: 'real-second', sender_id: ME, body: 'same' });
    list = mergeIncoming(list, second, ME);
    expect(list.some(isPending)).toBe(false);
    expect(list).toHaveLength(2);
  });

  it('does not let the peer settle our pending rows', () => {
    const pending = optimistic('mine', 1_000);
    const list = insertOptimistic([], pending);
    const theirs = message({ sender_id: THEM, body: 'mine' });

    const merged = mergeIncoming(list, theirs, ME);
    expect(merged).toHaveLength(2);
    expect(merged.some(isPending)).toBe(true);
  });
});

describe('sessionEndedLabel — a chat session in the history list', () => {
  /*
   * The text became "Chat · 12 min · 3:55 pm" on 2026-09-13 (Amit: "Session
   * metadata history should show type of session with duration and timestamp").
   *
   * Three deliberate changes, each worth an assertion rather than one string
   * compare: it names the CHANNEL (there is more than one kind of session now),
   * it carries a TIME (the part that makes a history navigable), and it drops
   * the words "Session ended" — every row in this list is an ended session, so
   * the phrase did no work while the channel it did not name did.
   *
   * The shape matches CallLogRow's "Voice call · 4:32 · 3:55 pm" on purpose:
   * the two sit next to each other and are the whole of a member's history
   * across sessions, so they must read as one list.
   */
  it('names the channel and the billed minutes', () => {
    expect(sessionEndedLabel(5)).toBe('Chat · 5 min');
    expect(sessionEndedLabel(1)).toBe('Chat · 1 min');
  });

  it('appends the time when the session end is known', () => {
    const at = '2026-09-13T10:25:00.000Z';
    const label = sessionEndedLabel(12, at);
    expect(label.startsWith('Chat · 12 min · ')).toBe(true);
    // The clock itself is locale-formatted, so assert it came from the same
    // formatter the call log uses rather than hard-coding a rendering.
    expect(label.endsWith(timeOfDay(at))).toBe(true);
  });

  it('drops the duration for a session that never billed, keeping the time', () => {
    const at = '2026-09-13T10:25:00.000Z';
    expect(sessionEndedLabel(0)).toBe('Chat');
    expect(sessionEndedLabel(Number.NaN)).toBe('Chat');
    expect(sessionEndedLabel(-3)).toBe('Chat');
    // A session nobody used still belongs in the history, and still at a time.
    expect(sessionEndedLabel(0, at)).toBe(`Chat · ${timeOfDay(at)}`);
  });

  it('no longer says "Session ended", which every row in the list is', () => {
    expect(sessionEndedLabel(5)).not.toContain('Session ended');
    expect(sessionEndedLabel(0)).not.toContain('Session ended');
  });
});

describe('insertOptimistic replaces a retried row instead of duplicating it', () => {
  it('reviving a failed send (same pending id) keeps one row, in place', () => {
    // A tap-to-retry or an outbox replay rebuilds the optimistic row with the
    // SAME pending-<nonce> id. A blind prepend left the failed row beside the
    // retried one (duplicate FlashList keys) and stranded it as a phantom
    // "failed" bubble after the resend confirmed by a different id. (2026-09-09)
    const earlier = message({ id: 'earlier', body: 'earlier' });
    let list = insertOptimistic([earlier], optimistic('flaky', 1_000));
    expect(list).toHaveLength(2);

    // Retry: identical id, fresh row.
    list = insertOptimistic(list, optimistic('flaky', 1_000));

    expect(list.filter(m => m.id === `${PENDING_PREFIX}1000`)).toHaveLength(1);
    expect(list).toHaveLength(2);
    // Replaced in place: the revived row stays where the first send prepended it
    // (index 0), which the preserved created_at is meant to guarantee.
    expect(list[0]?.id).toBe(`${PENDING_PREFIX}1000`);
  });
});

describe('settleOptimistic', () => {
  it('swaps the pending row for the confirmed one', () => {
    const pending = optimistic('hello', 1_000);
    const list = insertOptimistic([], pending);
    const confirmed = message({ id: 'real', sender_id: ME, body: 'hello' });

    const settled = settleOptimistic(list, pending.id, confirmed);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe('real');
  });

  it('withdraws the pending row when the send failed', () => {
    const pending = optimistic('doomed', 1_000);
    const list = insertOptimistic([message()], pending);

    const settled = settleOptimistic(list, pending.id, null);
    expect(settled).toHaveLength(1);
    expect(settled.some(isPending)).toBe(false);
  });

  /**
   * Realtime won the race: the pending row is already gone by the time the RPC
   * response arrives. Settling again must not resurrect a duplicate.
   */
  it('is a no-op when Realtime already settled the row', () => {
    const confirmed = message({ id: 'real', sender_id: ME, body: 'hello' });
    const list = mergeIncoming([], confirmed, ME);

    const settled = settleOptimistic(list, `${PENDING_PREFIX}1000`, confirmed);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe('real');
  });

  it('drops the pending row if the confirmed one landed separately', () => {
    const pending = optimistic('hello', 1_000);
    const confirmed = message({ id: 'real', sender_id: ME, body: 'hello' });
    // Both present: Realtime inserted under a new id before the RPC returned.
    const list = [confirmed, pending];

    const settled = settleOptimistic(list, pending.id, confirmed);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe('real');
  });

  it('leaves the list alone when a failed send has nothing to withdraw', () => {
    const list = [message()];
    expect(settleOptimistic(list, 'pending-nope', null)).toEqual(list);
  });
});

describe('applyReadReceipt', () => {
  it('latches read_at on the addressed row', () => {
    const row = message({ sender_id: ME });
    const list = [row];
    const next = applyReadReceipt(list, row.id, '2026-01-01T00:00:00.000Z');
    expect(next[0]?.read_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('never overwrites an existing receipt', () => {
    const row = message({ sender_id: ME, read_at: '2026-01-01T00:00:00.000Z' });
    const next = applyReadReceipt([row], row.id, '2026-06-06T00:00:00.000Z');
    expect(next[0]?.read_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('ignores a receipt for a row it has never seen', () => {
    const list = [message()];
    expect(applyReadReceipt(list, 'unknown', '2026-01-01T00:00:00.000Z')).toEqual(list);
  });
});

describe('unreadFromPeer', () => {
  /**
   * Filtering by sender is not an optimisation. The RLS policy on `messages`
   * rejects marking your own message read, so including one would fail the whole
   * batched update and lose the legitimate receipts with it.
   */
  it('returns only the peer’s unread, never our own', () => {
    const theirUnread = message({ sender_id: THEM });
    const theirRead = message({ sender_id: THEM, read_at: '2026-01-01T00:00:00.000Z' });
    const mine = message({ sender_id: ME });

    expect(unreadFromPeer([theirUnread, theirRead, mine], ME)).toEqual([theirUnread.id]);
  });

  it('never tries to mark a pending row read', () => {
    const pending = optimistic('mine', 1_000);
    expect(unreadFromPeer([pending], THEM)).toEqual([]);
  });

  it('returns nothing without a session', () => {
    expect(unreadFromPeer([message()], undefined)).toEqual([]);
  });
});

describe('lastOwnMessageId', () => {
  it('is the newest message we sent, so only one receipt renders', () => {
    const newestMine = message({ sender_id: ME });
    const theirs = message({ sender_id: THEM });
    const olderMine = message({ sender_id: ME });

    // Newest-first.
    expect(lastOwnMessageId([newestMine, theirs, olderMine], ME)).toBe(newestMine.id);
  });

  it('is undefined when we have not spoken yet', () => {
    expect(lastOwnMessageId([message({ sender_id: THEM })], ME)).toBeUndefined();
  });
});

/**
 * A settled row keeps the identity its optimistic version had.
 *
 * This is a rendering invariant expressed in data, and it was found on a 30fps
 * screen recording rather than by reasoning: the bubble appeared, vanished for
 * two frames, and replayed the entire send animation. The cause was that
 * settlement swaps `pending-…` for a uuid, so the list key changed and FlatList
 * unmounted the component mid-animation and mounted a different one.
 *
 * Nothing else in this suite would notice, every existing assertion is about
 * the *contents* of the list, and the contents were right both times.
 */
describe('optimistic rows keep their identity through settlement', () => {
  const CONFIRMED: Message = {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    conversation_id: 'c1',
    sender_id: 'me',
    body: 'hello',
    reply_to_id: null,
    voice_path: null,
    voice_duration_ms: null,
    voice_peaks: null,
    attachment_path: null,
    attachment_type: null,
    attachment_width: null,
    attachment_height: null,
    session_id: null,
    origin: 'live',
    created_at: '2026-01-01T00:00:00.000Z',
    read_at: null,
  };

  const pending = (id: string): Message => ({ ...CONFIRMED, id, created_at: CONFIRMED.created_at });

  it('carries the pending id forward when the RPC settles it', () => {
    const list = insertOptimistic([], pending('pending-1'));
    const settled = settleOptimistic(list, 'pending-1', CONFIRMED);
    expect(settled[0]?.id).toBe(CONFIRMED.id);
    expect(settled[0]?.localKey).toBe('pending-1');
  });

  it('carries it forward when Realtime settles it first', () => {
    const list = insertOptimistic([], pending('pending-2'));
    const settled = mergeIncoming(list, CONFIRMED, 'me');
    expect(settled[0]?.id).toBe(CONFIRMED.id);
    expect(settled[0]?.localKey).toBe('pending-2');
  });

  it('keeps the key stable however the two paths interleave', () => {
    // The whole point of the reconciliation being order-independent: whichever
    // path lands first, the rendered key must not change on the second.
    const first = mergeIncoming(insertOptimistic([], pending('pending-3')), CONFIRMED, 'me');
    const second = settleOptimistic(first, 'pending-3', CONFIRMED);
    expect(second).toHaveLength(1);
    const key = (m: Message & { localKey?: string }): string => m.localKey ?? m.id;
    expect(key(first[0]!)).toBe('pending-3');
    expect(key(second[0]!)).toBe('pending-3');
  });

  it('leaves a peer message with no local key, so it keys on its own id', () => {
    const peer: Message = { ...CONFIRMED, id: 'peer-1', sender_id: 'them' };
    const merged = mergeIncoming([], peer, 'me');
    expect(merged[0]?.localKey).toBeUndefined();
  });
});

/**
 * A voice note has no body, which is the one thing the reconciliation was never
 * written against: it matches a confirmed row from this session to the oldest
 * pending row *with the same body*, and for two voice notes that comparison is
 * `null === null`.
 *
 * That still works, and these cases are what says so. If the matcher is ever
 * "improved" to compare on something else, this is what notices.
 */
describe('settling a voice note, which has no body to match on', () => {
  const voice = (id: string, path: string, at: number): Message =>
    message({
      id,
      sender_id: ME,
      body: null,
      voice_path: path,
      voice_duration_ms: 4000,
      created_at: new Date(1_700_000_000_000 + at).toISOString(),
    });

  it('settles a pending voice row against the confirmed one', () => {
    const list = insertOptimistic([], voice(`${PENDING_PREFIX}1`, 'a/b.m4a', 10));
    const settled = mergeIncoming(list, voice('server-1', 'a/b.m4a', 10), ME);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe('server-1');
    expect(settled[0]?.localKey).toBe(`${PENDING_PREFIX}1`);
  });

  it('does not settle a voice note against a pending text message', () => {
    // The failure this pins: `row.body === incoming.body` is false for a text
    // draft against a null-bodied voice row, so the text bubble must survive.
    const list = insertOptimistic([], optimistic('still typing this', 20));
    const settled = mergeIncoming(list, voice('server-2', 'a/c.m4a', 30), ME);
    expect(settled).toHaveLength(2);
    expect(settled.some(m => isPending(m) && m.body === 'still typing this')).toBe(true);
  });

  it('settles two pending voice notes oldest first', () => {
    // Both have a null body, so the matcher cannot tell them apart on content.
    // Oldest-pending-first is what keeps them in the order they were recorded.
    let list = insertOptimistic([], voice(`${PENDING_PREFIX}1`, 'a/b.m4a', 10));
    list = insertOptimistic(list, voice(`${PENDING_PREFIX}2`, 'a/c.m4a', 20));
    const settled = mergeIncoming(list, voice('server-1', 'a/b.m4a', 10), ME);
    expect(settled.find(m => m.id === 'server-1')?.localKey).toBe(`${PENDING_PREFIX}1`);
    expect(settled.some(m => m.id === `${PENDING_PREFIX}2`)).toBe(true);
  });

  it('withdraws the row when the upload or the RPC failed', () => {
    const list = insertOptimistic([], voice(`${PENDING_PREFIX}1`, 'a/b.m4a', 10));
    expect(settleOptimistic(list, `${PENDING_PREFIX}1`, null)).toHaveLength(0);
  });

  it('keeps a bodiless peer message searchable as nothing rather than as null', () => {
    // `unreadFromPeer` reads sender and read_at only, so a voice note is marked
    // read like anything else. Asserted because a body-based filter would silently
    // stop marking voice notes read, and the peer would see "Sent" forever.
    const peer = { ...voice('peer-voice', 'a/d.m4a', 40), sender_id: THEM };
    expect(unreadFromPeer([peer], ME)).toEqual(['peer-voice']);
  });
});
