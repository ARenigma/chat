/**
 * Pure navigation planners and imperative dispatch helpers.
 *
 * Pure functions (glareDecision, resolveOpenChat) return a description of
 * what to do; they carry no side effects and are unit-tested in isolation.
 * Imperative wrappers (removeSelf) dispatch through navigationRef.
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useNotificationHandler.ts
 * and src/Navigation.tsx (MIT), see THIRD_PARTY_LICENSES.md
 */

import { StackActions } from '@react-navigation/native';

import { navigationRef } from './navigationRef';

// ---------------------------------------------------------------------------
// Glare decision (incoming-call race)
// ---------------------------------------------------------------------------

export type ActiveCall = {
  seq: number;
  callId: string | null;
  peerId: string;
  direction: 'in' | 'out';
};

export type IncomingCallIntent = {
  type: 'incomingCall';
  peerId: string;
  callId: string;
};

/**
 * Decides what to do when a second incoming-call signal arrives while a call
 * is already active. Returns:
 *
 * - `'duplicate'`     — same callId already on screen; drop silently.
 * - `'ownDialRace'`   — this is the M23 own-dial echo; drop silently.
 * - `'busyDecline'`   — a genuinely different call; busy-decline it.
 *
 * Pure: no side effects, unit-tested.
 *
 * Three branches from nav-migration §3.
 */
export type GlareDecision = 'duplicate' | 'ownDialRace' | 'busyDecline';

export function glareDecision(
  activeCall: ActiveCall,
  intent: IncomingCallIntent,
): GlareDecision {
  if (activeCall.callId === intent.callId) {
    // Same call already on screen.
    return 'duplicate';
  }
  if (
    activeCall.direction === 'out' &&
    activeCall.callId === null &&
    activeCall.peerId === intent.peerId
  ) {
    // Own outgoing call: the M23 own-dial race where start_call will report
    // ALREADY_RINGING. Drop; the existing call remains.
    return 'ownDialRace';
  }
  // A genuinely different live call is already on screen.
  return 'busyDecline';
}

// ---------------------------------------------------------------------------
// Chat plan (pure planner)
// ---------------------------------------------------------------------------

/**
 * Describes the navigation action required to open a chat, without executing
 * it. `applyChatPlan` performs the actual dispatch.
 *
 * Rules, first match wins — nav-migration §3 resolveOpenChat.
 */
export type ChatPlan =
  | {
      kind: 'popTo';
      /** Index of the Chat route within its stack. */
      routeIndex: number;
      stackKey: string;
      tabSwitch?: string;
      /** Route to remove if it sits above the target after the pop. */
      removeSource?: { source: string; target: string };
    }
  | {
      kind: 'replace';
      /** Source route key for targeted replacement. */
      source: string;
      /** Stack key for targeted replacement. */
      target: string;
      peerId: string;
    }
  | { kind: 'push'; peerId: string; target?: string }
  | { kind: 'switchAndPush'; tab: string; peerId: string }
  | { kind: 'noop' };

export type ChatOrigin =
  | 'intent'
  | 'inApp'
  | 'callEnd'
  | 'requestAccept'
  | 'suggestionAccept';

/**
 * Resolves what navigation is needed to open Chat(peerId) from the current
 * root state. Returns a pure plan; side effects are in applyChatPlan.
 *
 * NOTE: Full implementation lands in step 7 when Navigation.tsx mounts.
 * This stub returns a 'push' plan so callers and tests have a working
 * interface to program against.
 *
 * nav-migration §3.
 */
export function resolveOpenChat(
  _state: ReturnType<typeof navigationRef.getRootState> | undefined,
  peerId: string,
  origin: ChatOrigin,
  _sourceKey?: string,
): ChatPlan {
  // Step 2 stub: always push. Full routing logic (popTo, replace, tab switch)
  // is implemented in step 7 once the navigator tree exists.
  if (origin === 'intent') {
    return { kind: 'switchAndPush', tab: 'HomeTab', peerId };
  }
  return { kind: 'push', peerId };
}

// ---------------------------------------------------------------------------
// Imperative dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Removes exactly one route from its stack by key, even when it is not at
 * the top. Dispatches with `source` + `target` so StackRouter acts on that
 * specific route rather than on `state.index` (StackRouter.tsx:557-575).
 *
 * A contract pin forbids any code calling `navigationRef.goBack()` directly.
 * nav-migration §3, §4.
 */
export function removeSelf(
  routeKey: string,
  stackKey: string,
): void {
  if (!navigationRef.isReady()) {
    return;
  }
  navigationRef.dispatch({
    ...StackActions.pop(1),
    source: routeKey,
    target: stackKey,
  });
}
