/**
 * App-wide event bus using a plain module-level Set — no eventemitter3.
 *
 * Bluesky's events.ts uses eventemitter3; that package is not installed and
 * is not needed. A module Set is sufficient: order is insertion order,
 * listeners can be added and removed, and there is no cross-module state
 * beyond the Set itself.
 *
 * adapted from bluesky-social/social-app src/state/events.ts (MIT),
 * see THIRD_PARTY_LICENSES.md
 *
 * Only emitSoftReset / listenSoftReset are needed for step 2.
 * Additional events (sessionDropped, networkConfirmed …) are added in the
 * steps that wire their consumers.
 */

type Listener = () => void;
type UnlistenFn = () => void;

// ---------------------------------------------------------------------------
// Soft reset
// ---------------------------------------------------------------------------

const softResetListeners = new Set<Listener>();

/**
 * Fires when the active tab button is pressed while the tab is already at
 * its root screen. Each tab root scrolls to top and optionally refreshes.
 *
 * adapted from bluesky-social/social-app src/state/events.ts (MIT)
 */
export function emitSoftReset(): void {
  for (const fn of softResetListeners) {
    fn();
  }
}

/**
 * Subscribes to soft-reset events. Returns an unsubscribe function.
 *
 * adapted from bluesky-social/social-app src/state/events.ts (MIT)
 */
export function listenSoftReset(fn: Listener): UnlistenFn {
  softResetListeners.add(fn);
  return () => {
    softResetListeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Tab press
// ---------------------------------------------------------------------------

type TabListener = (tab: string) => void;
const tabPressListeners = new Set<TabListener>();

/**
 * Fires on EVERY bottom-bar press, with the tab pressed: a re-tap, a pop to
 * root, or arriving from another tab. The soft reset above is only the re-tap
 * at the root; this is what lets a screen close transient state (search) the
 * moment its own tab is pressed, whichever of the three it was.
 */
export function emitTabPress(tab: string): void {
  for (const fn of tabPressListeners) {
    fn(tab);
  }
}

export function listenTabPress(fn: TabListener): UnlistenFn {
  tabPressListeners.add(fn);
  return () => {
    tabPressListeners.delete(fn);
  };
}
