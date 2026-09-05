import { useEffect } from 'react';

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

const guards: BackGuard[] = [];

/** Push a guard; returns its own removal. Removal is by identity, so a guard may be re-registered safely. */
export function registerBackGuard(guard: BackGuard): () => void {
  guards.push(guard);
  return () => {
    const at = guards.lastIndexOf(guard);
    if (at >= 0) {
      guards.splice(at, 1);
    }
  };
}

/**
 * Offer the press to the guards, innermost first. True when one of them took
 * it, in which case the caller must not navigate.
 */
export function consumeBack(): boolean {
  for (let i = guards.length - 1; i >= 0; i -= 1) {
    const guard = guards[i];
    if (guard !== undefined && guard()) {
      return true;
    }
  }
  return false;
}

/** How many guards are registered — for tests and for asserting a clean unmount. */
export function backGuardCount(): number {
  return guards.length;
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
