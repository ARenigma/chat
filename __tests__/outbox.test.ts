import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OUTBOX_LIMIT,
  decode,
  forConversation,
  withAttempt,
  withEntry,
  withoutEntry,
  type OutboxEntry,
} from '../src/lib/outbox';

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8');

const entry = (nonce: string, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  nonce,
  conversationId: 'conv-1',
  body: `body ${nonce}`,
  replyToId: null,
  createdAt: '2026-09-08T00:00:00.000Z',
  attempts: 1,
  ...over,
});

/**
 * The persisted send queue — Telegram's `send_state = 1` row, which is what
 * makes a send survive the process dying. See `src/lib/outbox.ts`.
 */
describe('the outbox list operations', () => {
  it('adds an entry', () => {
    expect(withEntry([], entry('a')).map(e => e.nonce)).toEqual(['a']);
  });

  it('replaces by nonce rather than appending a second copy', () => {
    // The nonce IS the message's identity. Two entries with one nonce would
    // both be replayed, and being idempotent server-side is not a licence to
    // send the same thing twice.
    const list = withEntry(withEntry([], entry('a')), entry('a', { body: 'newer' }));
    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe('newer');
  });

  it('keeps insertion order, oldest first', () => {
    const list = withEntry(withEntry([], entry('a')), entry('b'));
    expect(list.map(e => e.nonce)).toEqual(['a', 'b']);
  });

  it('caps the queue, keeping the OLDEST', () => {
    /*
     * The direction matters and is the opposite of the usual instinct. An
     * outbox only grows while sends are failing, and on recovery it replays
     * everything at once — so the cap protects the recipient. Keeping the
     * oldest keeps what the member most meant to say; keeping the newest would
     * silently drop the start of a conversation.
     */
    let list: OutboxEntry[] = [];
    for (let i = 0; i < OUTBOX_LIMIT + 10; i += 1) {
      list = withEntry(list, entry(`n${i}`));
    }
    expect(list).toHaveLength(OUTBOX_LIMIT);
    expect(list[0]?.nonce).toBe('n0');
    expect(list.at(-1)?.nonce).toBe(`n${OUTBOX_LIMIT - 1}`);
  });

  it('removes by nonce', () => {
    const list = withoutEntry([entry('a'), entry('b')], 'a');
    expect(list.map(e => e.nonce)).toEqual(['b']);
  });

  it('bumps only the named entry', () => {
    const list = withAttempt([entry('a'), entry('b')], 'a');
    expect(list.find(e => e.nonce === 'a')?.attempts).toBe(2);
    expect(list.find(e => e.nonce === 'b')?.attempts).toBe(1);
  });

  it('scopes to a conversation', () => {
    const list = [entry('a'), entry('b', { conversationId: 'conv-2' })];
    expect(forConversation(list, 'conv-1').map(e => e.nonce)).toEqual(['a']);
  });
});

describe('decoding what storage hands back', () => {
  /*
   * Storage survives app upgrades, so its contents are untrusted input. A shape
   * written by an older build must never crash a newer one — the failure would
   * land at boot, which is the worst place for it.
   */
  it('reads back what it wrote', () => {
    const list = [entry('a'), entry('b')];
    expect(decode(JSON.stringify(list))).toEqual(list);
  });

  it('treats absent, empty and corrupt alike', () => {
    expect(decode(undefined)).toEqual([]);
    expect(decode(null)).toEqual([]);
    expect(decode('')).toEqual([]);
    expect(decode('{ not json')).toEqual([]);
    // A JSON object rather than an array: valid JSON, wrong shape.
    expect(decode('{"nonce":"a"}')).toEqual([]);
  });

  it('drops malformed entries but keeps the good ones', () => {
    const raw = JSON.stringify([
      entry('good'),
      { nonce: 'missing-fields' },
      { ...entry('bad-attempts'), attempts: 'lots' },
      null,
    ]);
    expect(decode(raw).map(e => e.nonce)).toEqual(['good']);
  });
});

describe('the send path persists before it sends', () => {
  /*
   * The ORDER is the mechanism, not a detail: a row that exists only after the
   * server answers is a row that a process kill erases. Telegram writes at
   * `send_state = 1` before touching the network (MessagesStorage.java:551).
   * Asserted over source because the failure mode — enqueueing after the
   * await — is invisible at runtime until an app is killed at the wrong moment.
   */
  const chat = read('src/api/chat.ts');

  it('enqueues before the RPC, not after', () => {
    const enqueueAt = chat.indexOf('enqueue({');
    const rpcAt = chat.indexOf("supabase.rpc('send_message_idempotent'");
    expect(enqueueAt).toBeGreaterThan(0);
    expect(rpcAt).toBeGreaterThan(0);
    expect(enqueueAt).toBeLessThan(rpcAt);
  });

  it('queues the nonce, which is what makes a replay safe', () => {
    // Replaying without the original nonce is a duplicate generator, not a
    // retry. Migration 081 is only load-bearing if the same value comes back.
    const block = chat.slice(chat.indexOf('enqueue({'), chat.indexOf('enqueue({') + 200);
    expect(block).toContain('nonce,');
  });

  it('drops the entry once the send lands or is deduped', () => {
    expect(chat).toContain('dequeue(nonce)');
  });

  it('does not keep replaying a send the server refuses', () => {
    // Offline is worth retrying; BLOCKED or RATE_LIMITED is not — that would
    // replay forever against a server that will keep saying no.
    expect(chat).toContain('worthRetrying');
    expect(chat).toMatch(/result\.error === undefined/);
  });

  it('caps automatic replays', () => {
    expect(chat).toContain('REPLAY_LIMIT');
    expect(chat).toMatch(/entry\.attempts >= REPLAY_LIMIT/);
  });
});

describe('a failed send keeps its bubble', () => {
  const chat = read('src/api/chat.ts');
  const turn = read('src/components/Turn.tsx');

  it('marks the row failed instead of deleting it', () => {
    // It used to splice the row out, so the member watched their message
    // vanish and had to retype it. Telegram keeps it at SEND_ERROR.
    expect(chat).toContain('markFailed(prev ?? [], pendingId)');
    expect(chat).not.toContain('settleOptimistic(prev ?? [], pendingId, null)');
  });

  it('never shows a tick and a failure together', () => {
    // A check mark beside a message that did not send is the single most
    // misleading thing the bubble could say.
    const at = turn.indexOf('failed === true ? (');
    expect(at).toBeGreaterThan(0);
    const block = turn.slice(at, at + 900);
    expect(block).toContain(') : receipt !== undefined ? (');
  });

  it('makes the failed bubble the retry target', () => {
    expect(turn).toContain('failed === true && onRetry !== undefined');
  });
});

describe('the bubble tail, ported from WhatsApp', () => {
  /*
   * Confirmed on the Redmi before being built: WhatsApp Android DOES draw a
   * tail, at the bubble's TOP corner, widest at the top and tapering down —
   * matching its own tail-out.svg viewBox "0 0 8 13". Not the bottom corner,
   * which is where iMessage puts it and where most clones put theirs.
   */
  const turn = read('src/components/Turn.tsx');
  const chat = read('src/screens/ChatScreen.tsx');

  it('uses WhatsApp own 8x13 dimensions', () => {
    expect(turn).toMatch(/TAIL_W = 8/);
    expect(turn).toMatch(/TAIL_H = 13/);
  });

  it('draws it with borders, not react-native-svg', () => {
    /*
     * RULE 5: react-native-svg is banned — it throws
     * synchronouslyUpdateUIProps inside Reanimated views and kills touch on the
     * whole subtree, which is precisely the subtree a chat bubble lives in.
     */
    /*
     * Comments stripped first. The naive version of this assertion failed on
     * the comment above it, which names the banned package in order to explain
     * why it is banned — the same self-referential trap that the fontWeight
     * gate hit once before.
     */
    const code = turn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/react-native-svg/);
    expect(turn).toContain('borderTopColor: t.color.bubble.mine');
    expect(turn).toContain('borderTopColor: t.color.bubble.theirs');
  });

  it('puts it on the top corner, outside the bubble, on both sides', () => {
    for (const side of ['tailMine', 'tailPeer'] as const) {
      const at = turn.indexOf(`${side}: {`);
      expect(at).toBeGreaterThan(0);
      const block = turn.slice(at, at + 340);
      expect(block).toContain('top: 0');
      // Negative offset: outside the bubble, so it costs the text box no width.
      expect(block).toMatch(/-TAIL_W/);
    }
  });

  it('squares the tail-side corner only', () => {
    // Measured ~1dp on WhatsApp against 9dp on the other three. Without it the
    // tail looks detached from a rounded corner instead of growing out of one.
    expect(turn).toContain('tailCornerMine: { borderTopRightRadius: 1 }');
    expect(turn).toContain('tailCornerPeer: { borderTopLeftRadius: 1 }');
  });

  it('shows it only on the first bubble of a run', () => {
    // WhatsApp tails the oldest bubble of a run; the rest are fully rounded.
    // `first` already means exactly that (sender differs from the older
    // neighbour), so no second notion of grouping was invented.
    expect(chat).toContain('tail={first}');
    expect(turn).toContain('testID="bubble-tail-mine"');
    expect(turn).toContain('testID="bubble-tail-peer"');
  });

  it('does not let the tail take a tap meant for the bubble', () => {
    const at = turn.indexOf('testID="bubble-tail-mine"');
    expect(turn.slice(at - 200, at)).toContain('pointerEvents="none"');
  });
});
