/**
 * Intent queue: deferred navigation signals from deep links, realtime events
 * and FCM pushes. Signals arrive before the navigator is ready (cold start,
 * role splash) or while a call owns the screen; this module holds them and
 * flushes in order once the navigator registers an applier.
 *
 * Modelled on Bluesky's storedAccountSwitchPayload pattern
 * (social-app src/lib/hooks/useNotificationHandler.ts, MIT).
 * nav-migration §3.
 */

import { AppState } from 'react-native';
import { glareDecision, type ActiveCall, type IncomingCallIntent } from './routes/actions';
import { useStore } from '../store/useStore';
// activeElements created alongside this module in step 3.
import { closeAllActiveElements } from './activeElements';
import { logEvent } from './sentry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A unique symbol used to tag intents produced before the session resolves.
 * Cold-start taps arrive before `useRole` knows the account; they are tagged
 * `BOOT` and adopted when the restored session reaches `ready`.
 * nav-migration §3.
 */
const BOOT: unique symbol = Symbol('BOOT');

type IntentOwner = string | null | typeof BOOT;

export type NavIntent =
  | { type: 'incomingCall'; peerId: string; callId: string; medium: 'voice' | 'video' }
  | { type: 'openChat'; peerId: string }
  | { type: 'openChatV2'; peerId: string; benchmarkReadOnly: boolean }
  | { type: 'chatRequest'; requestId: string; peerId: string };

type TaggedIntent = NavIntent & { _owner: IntentOwner };

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Injectable call hooks — avoids importing calls.ts/conversations.ts (which
// pull in native Supabase/MMKV modules unavailable in Jest). App.tsx wires
// these once at boot; tests substitute stubs.
// ---------------------------------------------------------------------------

type CallHooks = {
  /** Busy-decline an incoming call the glare guard rejected. */
  endCall: (callId: string) => Promise<unknown>;
  /** Remove the CallStyle notification once the in-app ring takes over. */
  clearCall: (callId: string) => Promise<void>;
};

let _callHooks: CallHooks = {
  endCall: () => Promise.resolve(null),
  clearCall: () => Promise.resolve(),
};

/** Wire the live call API. Called once from App.tsx at boot. */
export function setCallHooks(hooks: CallHooks): void {
  _callHooks = hooks;
}

let _applier: ((intent: NavIntent) => void) | null = null;
let _owner: IntentOwner = BOOT;
const _queue: TaggedIntent[] = [];

/**
 * callIds that have already been routed in this session. Bounded to 50 to
 * avoid unbounded growth; realistically the session holds at most a handful
 * of calls. Survives role remounts because it is module-level, not component
 * state — preventing a role flip from re-routing the same callId.
 * nav-migration §3.
 */
export const routedCalls = new Set<string>();
const ROUTED_CALLS_MAX = 50;

/**
 * callIds that have ended in this session. When `activeCall.callId` is found
 * here, `flushIntents` treats the glare lock as stale and clears it so the
 * next incoming ring is not erroneously busy-declined.
 *
 * Covers the B-BS-4 scenario: an unanswered ring times out, `finish` fires in
 * CallScreen, but `endActiveCall` is never called (the route is blocked from
 * unmounting or captured the wrong seq), leaving `activeCall` set. Without this
 * backstop the next ring meets a non-null `activeCall` and is busy-declined.
 * nav-migration §3.
 */
export const endedCallIds = new Set<string>();
const ENDED_CALLS_MAX = 50;

/**
 * Mark a call as finished. Called from CallScreen's `finish()` the moment this
 * device considers the call over. The intent queue reads this to bypass a stale
 * glare lock before applying `glareDecision`. Bounded to ENDED_CALLS_MAX.
 */
export function markCallEnded(callId: string): void {
  if (endedCallIds.size >= ENDED_CALLS_MAX) {
    const first = endedCallIds.values().next().value as string;
    endedCallIds.delete(first);
  }
  endedCallIds.add(callId);
}

/** Test helper: reset ended call tracking. @internal */
export function _resetEndedCallIds(): void {
  endedCallIds.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the navigator's dispatch function. Called from the navigator's
 * `onReady` (step 7) or from SignedIn once the role is known (step 3 old tree).
 * Pass `null` on navigator unmount to re-enter the hold state.
 */
export function setIntentApplier(a: ((intent: NavIntent) => void) | null): void {
  _applier = a;
  if (a !== null) {
    flushIntents();
  }
}

/**
 * Adopt a session identity. Intents tagged `BOOT` are adopted by the first
 * non-null owner. Intents tagged with a DIFFERENT uid are dropped. Passing
 * `null` means signing out; subsequent intents will be tagged `null` and
 * dropped at flush.
 * nav-migration §3.
 */
export function setIntentOwner(o: string | null): void {
  _owner = o;
  flushIntents();
}

/**
 * Enqueue a navigation intent. Tags it with the current owner (BOOT if the
 * session has not resolved) and attempts to flush immediately.
 */
export function enqueueIntent(intent: NavIntent): void {
  const tagged: TaggedIntent = { ...intent, _owner };
  _queue.push(tagged);
  flushIntents();
}

/** Drop all queued intents. Called from Root on `signedOut`. */
export function clearIntents(): void {
  _queue.length = 0;
}

/**
 * Test helper: reset owner to the BOOT sentinel. Not exported for production
 * use — production code only calls `setIntentOwner(string | null)`.
 * @internal
 */
export function _setIntentOwnerBoot(): void {
  _owner = BOOT;
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------

/**
 * Process the queue according to the rules in nav-migration §3.
 *
 * Flush rules, in order:
 * 1. No applier registered → hold everything.
 * 2. Owner check: drop intents whose tag is neither the current owner nor an
 *    adopted BOOT tag.
 * 3. incomingCall intents first: glare check, routedCalls dedup, then route.
 * 4. While activeCall is set, hold every other intent.
 * 5. chatRequest: drop if expired; otherwise closeAllActiveElements and apply.
 * 6. openChat / openChatV2: closeAllActiveElements and apply.
 */
export function flushIntents(): void {
  if (_applier === null) {
    return;
  }

  // -------------------------------------------------------------------------
  // Rule 2: owner check — purge intents that belong to a different session.
  //
  // _owner === BOOT: session not yet resolved. Keep BOOT-tagged intents but do
  //   NOT apply them yet (the navigator is not ready or the role is unknown).
  // _owner === null: signed out. Drop everything, including BOOT-tagged.
  // _owner === 'uid': active session. Apply own-tagged AND adopt BOOT-tagged.
  // -------------------------------------------------------------------------
  if (_owner === null) {
    // Signed out: every queued intent belongs to an account that has left.
    _queue.length = 0;
    return;
  }
  if (_owner === BOOT) {
    // Cold start: hold; do not drop (the session may still resolve).
    return;
  }

  // Active session: purge intents tagged with a different uid.
  for (let i = _queue.length - 1; i >= 0; i--) {
    const intent = _queue[i]!;
    const owned = intent._owner === _owner || intent._owner === BOOT;
    if (!owned) {
      _queue.splice(i, 1);
    }
  }

  if (_queue.length === 0) {
    return;
  }

  const applier = _applier;

  // -------------------------------------------------------------------------
  // Rule 3: drain ALL incomingCall intents first, regardless of queue position.
  // -------------------------------------------------------------------------
  const callIntents = _queue.filter(
    (i): i is TaggedIntent & { type: 'incomingCall' } => i.type === 'incomingCall',
  );
  for (const intent of callIntents) {
    _queue.splice(_queue.indexOf(intent), 1);

    const callIntent: IncomingCallIntent = { type: 'incomingCall', peerId: intent.peerId, callId: intent.callId };

    // Read FRESH on every ring: the first ring of this flush sets the active
    // call below, and a second ring in the same flush must meet the glare
    // rules against it rather than a snapshot taken before the loop.
    const activeCall: ActiveCall | null = useStore.getState().activeCall;
    if (activeCall !== null) {
      // Defensive backstop (B-BS-4): if this activeCall's callId was already
      // observed as ended by markCallEnded (e.g., the ring timed out and
      // finish() fired, but endActiveCall was never called due to a nav race
      // or usePreventRemove holding the route), clear the stale lock now so
      // the new ring is not erroneously busy-declined.
      if (activeCall.callId !== null && endedCallIds.has(activeCall.callId)) {
        logEvent('call_stale_lock_cleared', { medium: intent.medium });
        useStore.getState().endActiveCall(activeCall.seq);
        // Fall through: activeCall is now null; route this ring normally.
      } else {
        // An active call is already on screen: apply the glare rules.
        const decision = glareDecision(activeCall, callIntent);
        if (decision === 'duplicate' || decision === 'ownDialRace') {
          logEvent('call_ring_dropped_duplicate', { medium: intent.medium });
          continue;
        }
        // busyDecline: end the incoming call so the caller knows immediately,
        // and take its CallStyle notification down with it, or a dead ring
        // (with an Accept that can no longer answer) stays in the shade.
        logEvent('call_ring_busy_declined', { medium: intent.medium });
        void _callHooks.endCall(intent.callId);
        void _callHooks.clearCall(intent.callId);
        continue;
      }
    }

    // Dedup: the same callId must not route twice (Realtime and FCM can
    // both deliver the same ring). Bounded to ROUTED_CALLS_MAX.
    if (routedCalls.has(intent.callId)) {
      continue;
    }
    if (routedCalls.size >= ROUTED_CALLS_MAX) {
      const first = routedCalls.values().next().value as string;
      routedCalls.delete(first);
    }
    routedCalls.add(intent.callId);
    logEvent('call_ring_routed', { medium: intent.medium });

    // Close any active elements before the call takes the screen.
    // PaymentSheet in flight returns false; in that case leave the
    // CallStyle notification up so the user can still see the ring.
    const allClosed = closeAllActiveElements();
    if (allClosed && AppState.currentState === 'active') {
      // Clear the CallStyle notification now that the in-app UI takes over.
      // https://developer.android.com/develop/ui/views/notifications/call-style
      void _callHooks.clearCall(intent.callId);
    }

    // Set the active call in the store BEFORE dispatching to the applier so
    // the glare guard is already in place when a second ring arrives during
    // the navigation frame.
    useStore.getState().beginCall({ direction: 'in', peerId: intent.peerId, callId: intent.callId });
    applier(intent);
  }

  // -------------------------------------------------------------------------
  // Rule 4: hold every non-call intent while a call is on screen.
  // -------------------------------------------------------------------------
  const stillActive = useStore.getState().activeCall;
  if (stillActive !== null) {
    return;
  }

  // -------------------------------------------------------------------------
  // Rules 5–6: chatRequest, openChat, openChatV2.
  // -------------------------------------------------------------------------
  while (_queue.length > 0) {
    const intent = _queue.shift()!;

    if (intent.type === 'chatRequest') {
      const req = useStore.getState().incomingRequest;
      if (req === null || req.requestId !== intent.requestId) {
        // Already cleared or a different request is ringing — drop.
        continue;
      }
      if (Date.now() > req.expiresAt) {
        // Expired while queued.
        useStore.getState().clearIncomingRequest(intent.requestId);
        continue;
      }
      closeAllActiveElements();
      applier(intent);
      continue;
    }

    // openChat / openChatV2
    closeAllActiveElements();
    applier(intent);
  }
}

// ---------------------------------------------------------------------------
// Store subscription: flush when activeCall → null
// ---------------------------------------------------------------------------
// Deferred one frame so the call-end navigation lands before the next intent
// is dispatched (nav-migration §3).
//
// Zustand's top-level `subscribe` only accepts a single listener. Use the
// state-selector pattern by subscribing to the whole store and comparing.
let _prevActiveCall: ActiveCall | null = useStore.getState().activeCall;
useStore.subscribe(state => {
  if (state.activeCall === null && _prevActiveCall !== null) {
    setTimeout(flushIntents, 0);
  }
  _prevActiveCall = state.activeCall;
});
