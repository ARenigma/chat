import { useEffect, useLayoutEffect } from 'react';

/**
 * One seam for "back must not silently leave this screen".
 *
 * React Native's `BackHandler` calls its subscriptions last-registered-first
 * and stops at the first that returns true. That makes "who handles back" an
 * ORDERING contract between components that do not know about each other, and
 * the order was not stable: App.tsx re-subscribed whenever the Recharge overlay
 * opened or closed, ChatScreen whenever the session row refetched, and
 * whichever effect ran last fired first. Open Recharge from the chat bar, close
 * it, press back — and the chat could pop out from under a live paid session
 * with no confirm (found 2026-09-06 while wiring goal item 6).
 *
 * So App owns the single hardware-back subscription and asks here before it
 * pops anything. A screen that needs a decision registers a guard only while it
 * needs one — Android's own guidance for custom back is to intercept only in
 * the state that needs it — the innermost guard is consulted first, and a guard
 * that returns true has handled the press (opened its dialog) so nothing else
 * runs. No registration order to reason about: the stack IS the order.
 * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
 */
export type BackGuard = () => boolean;

/**
 * A stack entry is a screen's guard, or a BARRIER — the floor a covering screen
 * drops so that the guards beneath it stop hearing back presses.
 *
 * The barrier exists because a guard belongs to a screen, and the screen it
 * belongs to is not always the screen the user is looking at. App.tsx keeps
 * Home mounted under every pushed screen on purpose ("Home stays mounted
 * underneath, always" — returning to Home must not remount its lists), so
 * HomeScreen's search guard, registered while its search field is open, was
 * still on this stack while a chat covered Home. Open Home search, open a chat
 * from the results, press the system back button: the press went to Home's
 * guard, which closed a search field nobody could see and returned true, and
 * the chat did not pop. The app-bar arrow worked the whole time, because it
 * calls the screen's own handler and never touches this stack. (2026-09-13.)
 *
 * So `consumeBack` walks down from the top and STOPS at the first barrier:
 * guards above it belong to the screen on top and are asked, guards below
 * belong to screens that are currently covered and are not. That is the model
 * Android already describes for its own back stack — a destination's back
 * callbacks are enabled while it is the current destination, not while it
 * happens to exist.
 * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
 */
type Entry =
  | { readonly kind: 'guard'; readonly run: BackGuard }
  | { readonly kind: 'barrier' };

const stack: Entry[] = [];

/**
 * Removal is by ENTRY identity, not by guard identity: every registration gets
 * its own entry, so registering the same function twice and removing one of
 * them takes out that registration and not an arbitrary other one. A second
 * call is a no-op (`lastIndexOf` misses), which is what makes double-cleanup
 * from React's effect teardown safe.
 */
function removeEntry(entry: Entry): () => void {
  return () => {
    const at = stack.lastIndexOf(entry);
    if (at >= 0) {
      stack.splice(at, 1);
    }
  };
}

/** Push a guard; returns its own removal. */
export function registerBackGuard(guard: BackGuard): () => void {
  const entry: Entry = { kind: 'guard', run: guard };
  stack.push(entry);
  return removeEntry(entry);
}

/**
 * Push a barrier; returns its own removal. Everything registered BEFORE this
 * call is now covered and will not be offered a back press until the barrier
 * is removed.
 */
export function registerBackBarrier(): () => void {
  const entry: Entry = { kind: 'barrier' };
  stack.push(entry);
  return removeEntry(entry);
}

/**
 * Offer the press to the guards, innermost first, down to the floor of the
 * screen on top. True when one of them took it, in which case the caller must
 * not navigate.
 */
export function consumeBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry === undefined) {
      continue;
    }
    if (entry.kind === 'barrier') {
      // The floor of the covering screen. A covered screen does not answer back.
      return false;
    }
    if (entry.run()) {
      return true;
    }
  }
  return false;
}

/** How many guards are registered — for tests and for asserting a clean unmount. */
export function backGuardCount(): number {
  return stack.filter(entry => entry.kind === 'guard').length;
}

/** How many barriers are held — for tests and for asserting a clean unmount. */
export function backBarrierCount(): number {
  return stack.filter(entry => entry.kind === 'barrier').length;
}

/**
 * Hold a guard for the lifetime of a value. Pass `null` when the screen has
 * nothing to protect (no live session) so ordinary navigation stays immediate;
 * the guard should be memoised, since a new identity re-registers.
 */
export function useBackGuard(guard: BackGuard | null): void {
  useEffect(() => {
    if (guard === null) {
      return;
    }
    return registerBackGuard(guard);
  }, [guard]);
}

/**
 * Hold a barrier for the lifetime of a screen that covers the ones below it.
 *
 * `useLayoutEffect`, and that is the whole reliability of it: the barrier must
 * sit BELOW this screen's own guards, or it would cut them off along with the
 * covered ones. React runs every layout effect of a commit before any passive
 * effect of the same commit, so the barrier is pushed ahead of every
 * `useBackGuard` in this screen no matter where the calls sit in the component
 * body — a guard added above this one later cannot silently break it.
 * https://react.dev/reference/react/useLayoutEffect
 */
export function useBackBarrier(): void {
  useLayoutEffect(() => registerBackBarrier(), []);
}
