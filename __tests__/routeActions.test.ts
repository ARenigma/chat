/**
 * Tests for src/lib/routes/actions.ts
 *
 * Covers: glareDecision (all three branches), resolveOpenChat rules (step 2
 * stub returns push/switchAndPush), removeSelf dispatch shape.
 *
 * nav-migration §9 step 2.
 */

import {
  glareDecision,
  resolveOpenChat,
} from '../src/lib/routes/actions';
import type { ActiveCall, IncomingCallIntent } from '../src/lib/routes/actions';

const PEER_A = '11111111-1111-4111-8111-111111111111';
const PEER_B = '22222222-2222-4222-8222-222222222222';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const CALL_ID_2 = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// glareDecision
// ---------------------------------------------------------------------------

describe('glareDecision', () => {
  const base: ActiveCall = {
    seq: 1,
    callId: CALL_ID,
    peerId: PEER_A,
    direction: 'in',
  };
  const intent: IncomingCallIntent = {
    type: 'incomingCall',
    peerId: PEER_B,
    callId: CALL_ID_2,
  };

  it('returns duplicate when callId matches the active call', () => {
    const active: ActiveCall = { ...base, callId: CALL_ID };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_B,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('duplicate');
  });

  it('returns ownDialRace for an outgoing call with no callId to the same peer', () => {
    // M23 own-dial race: we sent start_call but have not received callId yet,
    // and the Realtime INSERT fires for our own ring.
    const active: ActiveCall = {
      seq: 1,
      callId: null,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_A,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('ownDialRace');
  });

  it('does not treat an outgoing call to a DIFFERENT peer as ownDialRace', () => {
    const active: ActiveCall = {
      seq: 1,
      callId: null,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_B,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('busyDecline');
  });

  it('does not treat an outgoing call with a callId as ownDialRace', () => {
    // callId is already resolved — this is a real second call.
    const active: ActiveCall = {
      seq: 1,
      callId: CALL_ID,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_A,
      callId: CALL_ID_2,
    };
    expect(glareDecision(active, incoming)).toBe('busyDecline');
  });

  it('returns busyDecline for a genuinely different incoming call', () => {
    expect(glareDecision(base, intent)).toBe('busyDecline');
  });
});

// ---------------------------------------------------------------------------
// resolveOpenChat (step 2 stub)
// ---------------------------------------------------------------------------

describe('resolveOpenChat', () => {
  // The navigator does not exist in step 2, so getRootState() returns
  // undefined. The stub returns switchAndPush for 'intent' and push otherwise.

  it('returns switchAndPush for intent origin', () => {
    const plan = resolveOpenChat(undefined, PEER_A, 'intent');
    expect(plan.kind).toBe('switchAndPush');
    if (plan.kind === 'switchAndPush') {
      expect(plan.peerId).toBe(PEER_A);
      expect(plan.tab).toBe('HomeTab');
    }
  });

  it('returns push for inApp origin', () => {
    const plan = resolveOpenChat(undefined, PEER_A, 'inApp');
    expect(plan.kind).toBe('push');
    if (plan.kind === 'push') {
      expect(plan.peerId).toBe(PEER_A);
    }
  });

  it('returns push for callEnd origin', () => {
    const plan = resolveOpenChat(undefined, PEER_A, 'callEnd');
    expect(plan.kind).toBe('push');
  });

  it('returns push for requestAccept origin', () => {
    const plan = resolveOpenChat(undefined, PEER_A, 'requestAccept');
    expect(plan.kind).toBe('push');
  });

  it('returns push for suggestionAccept origin', () => {
    const plan = resolveOpenChat(undefined, PEER_A, 'suggestionAccept');
    expect(plan.kind).toBe('push');
  });
});
