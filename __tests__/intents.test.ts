/**
 * Intent queue: flush rules, owner tags, glare, call hold, ring expiry.
 * nav-migration §3.
 */

import {
  _setIntentOwnerBoot,
  clearIntents,
  enqueueIntent,
  flushIntents,
  routedCalls,
  setIntentApplier,
  setIntentOwner,
  type NavIntent,
} from '../src/lib/intents';
import { resetStore, useStore } from '../src/store/useStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApplier(): { calls: NavIntent[]; fn: (i: NavIntent) => void } {
  const calls: NavIntent[] = [];
  return { calls, fn: (i: NavIntent) => calls.push(i) };
}

beforeEach(() => {
  resetStore();
  clearIntents();
  setIntentApplier(null);
  // Reset owner to BOOT so each test starts in the cold-start state.
  _setIntentOwnerBoot();
  routedCalls.clear();
});

// ---------------------------------------------------------------------------
// Rule 1: no applier → hold
// ---------------------------------------------------------------------------

describe('no applier registered', () => {
  it('holds every intent until an applier is set', () => {
    setIntentOwner('user-1');
    enqueueIntent({ type: 'openChat', peerId: 'p1' });
    // No applier: nothing has run yet.
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('openChat');
  });
});

// ---------------------------------------------------------------------------
// Rule 2: owner check
// ---------------------------------------------------------------------------

describe('owner check', () => {
  it('drops a null-tagged intent (pressed on the sign-in screen)', () => {
    setIntentOwner(null); // signed out
    enqueueIntent({ type: 'openChat', peerId: 'p1' });
    setIntentOwner('user-1'); // next account logs in
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    expect(calls).toHaveLength(0);
  });

  it('adopts a BOOT-tagged intent for the first non-null owner', () => {
    // _owner is already BOOT (set by beforeEach via _setIntentOwnerBoot).
    enqueueIntent({ type: 'openChat', peerId: 'p1' }); // tagged BOOT
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    // Still BOOT → held.
    expect(calls).toHaveLength(0);
    setIntentOwner('user-1'); // session resolved → adopt and flush
    expect(calls).toHaveLength(1);
  });

  it('drops a BOOT intent when the owner becomes null (signed out before a session resolved)', () => {
    // Both queued while owner is BOOT (no session resolved).
    enqueueIntent({ type: 'openChat', peerId: 'p1' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn); // still BOOT → held
    expect(calls).toHaveLength(0);
    setIntentOwner(null); // sign-out path clears the queue
    expect(calls).toHaveLength(0);
  });

  it('drops an intent tagged with a different uid', () => {
    setIntentOwner('user-1');
    enqueueIntent({ type: 'openChat', peerId: 'p1' }); // tagged user-1
    setIntentOwner('user-2'); // account switch
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 3: incomingCall first, glare
// ---------------------------------------------------------------------------

describe('incomingCall intents are taken first', () => {
  it('routes a call before an earlier openChat when both are queued before the applier', () => {
    setIntentOwner('user-1');
    // No applier yet — both pile up in the queue in arrival order.
    enqueueIntent({ type: 'openChat', peerId: 'p1' });
    enqueueIntent({ type: 'incomingCall', peerId: 'p2', callId: 'c1', medium: 'voice' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn); // flush: call intents drain first
    // incomingCall goes first; openChat is then held because activeCall is set.
    expect(calls[0]!.type).toBe('incomingCall');
    expect(calls).toHaveLength(1);
  });

  it('drops a duplicate callId (already routed)', () => {
    setIntentOwner('user-1');
    routedCalls.add('c1');
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'incomingCall', peerId: 'p1', callId: 'c1', medium: 'voice' });
    expect(calls).toHaveLength(0);
  });

  it('glare: duplicate callId with activeCall drops silently', () => {
    setIntentOwner('user-1');
    useStore.getState().beginCall({ direction: 'in', peerId: 'p1', callId: 'c1' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'incomingCall', peerId: 'p1', callId: 'c1', medium: 'voice' });
    expect(calls).toHaveLength(0);
  });

  it('glare: own-dial race drops silently', () => {
    setIntentOwner('user-1');
    // Outgoing call to p1 with callId null = own-dial race (M23).
    useStore.getState().beginCall({ direction: 'out', peerId: 'p1', callId: null });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'incomingCall', peerId: 'p1', callId: 'c-new', medium: 'voice' });
    expect(calls).toHaveLength(0);
  });

  it('glare: genuinely different call is NOT routed (busy-decline path, not applied)', () => {
    setIntentOwner('user-1');
    useStore.getState().beginCall({ direction: 'in', peerId: 'p1', callId: 'c1' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'incomingCall', peerId: 'p2', callId: 'c2', medium: 'voice' });
    // Busy-decline: endCall is called, intent is NOT routed.
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: hold other intents while activeCall !== null
// ---------------------------------------------------------------------------

describe('hold while activeCall is set', () => {
  it('holds openChat until activeCall is cleared', () => {
    setIntentOwner('user-1');
    const seq = useStore.getState().beginCall({ direction: 'in', peerId: 'p1', callId: 'c1' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'openChat', peerId: 'p2' });
    expect(calls).toHaveLength(0);
    useStore.getState().endActiveCall(seq);
    flushIntents();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('openChat');
  });

  it('holds chatRequest until activeCall is cleared', () => {
    setIntentOwner('user-1');
    const FUTURE = Date.now() + 30_000;
    useStore.getState().setIncomingRequest({
      requestId: 'req-1',
      conversationId: 'conv-1',
      peerId: 'p1',
      peerName: 'Alice',
      expiresAt: FUTURE,
    });
    const seq = useStore.getState().beginCall({ direction: 'in', peerId: 'p2', callId: 'c1' });
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'chatRequest', requestId: 'req-1', peerId: 'p1' });
    expect(calls).toHaveLength(0);
    useStore.getState().endActiveCall(seq);
    flushIntents();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('chatRequest');
  });
});

// ---------------------------------------------------------------------------
// Rule 5: chatRequest expiry
// ---------------------------------------------------------------------------

describe('chatRequest expiry', () => {
  it('drops an expired request and clears it from the store', () => {
    setIntentOwner('user-1');
    useStore.getState().setIncomingRequest({
      requestId: 'req-1',
      conversationId: 'conv-1',
      peerId: 'p1',
      peerName: 'Alice',
      expiresAt: Date.now() - 1_000, // already past
    });
    // Force into the rung list first so setIncomingRequest accepts it.
    // Actually setIncomingRequest already refuses it as expired, so
    // manually set the store for this test.
    useStore.setState({ incomingRequest: {
      requestId: 'req-1', conversationId: 'conv-1', peerId: 'p1', peerName: 'Alice',
      expiresAt: Date.now() - 1_000,
    }});
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'chatRequest', requestId: 'req-1', peerId: 'p1' });
    expect(calls).toHaveLength(0);
    expect(useStore.getState().incomingRequest).toBeNull();
  });

  it('routes a live request', () => {
    setIntentOwner('user-1');
    const FUTURE = Date.now() + 30_000;
    useStore.setState({ incomingRequest: {
      requestId: 'req-2', conversationId: 'conv-2', peerId: 'p2', peerName: 'Bob',
      expiresAt: FUTURE,
    }});
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'chatRequest', requestId: 'req-2', peerId: 'p2' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.type).toBe('chatRequest');
  });
});

// ---------------------------------------------------------------------------
// routedCalls dedup
// ---------------------------------------------------------------------------

describe('routedCalls deduplication', () => {
  it('adds a callId to routedCalls after glare check passes', () => {
    setIntentOwner('user-1');
    const { fn } = makeApplier();
    setIntentApplier(fn);
    enqueueIntent({ type: 'incomingCall', peerId: 'p1', callId: 'c-unique', medium: 'voice' });
    expect(routedCalls.has('c-unique')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearIntents
// ---------------------------------------------------------------------------

describe('clearIntents', () => {
  it('drops the entire queue', () => {
    setIntentOwner('user-1');
    enqueueIntent({ type: 'openChat', peerId: 'p1' });
    enqueueIntent({ type: 'openChat', peerId: 'p2' });
    clearIntents();
    const { calls, fn } = makeApplier();
    setIntentApplier(fn);
    expect(calls).toHaveLength(0);
  });
});
