import {
  PENDING_PREFIX,
  applyReadReceipt,
  insertOptimistic,
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
    // message composed second — otherwise the timestamps would swap.
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
