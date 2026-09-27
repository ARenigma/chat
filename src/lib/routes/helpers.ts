/**
 * Navigation state helpers.
 *
 * adapted from bluesky-social/social-app src/lib/routes/helpers.ts (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import type { State } from './types';

/**
 * Descends into nested navigator state to find the currently focused leaf
 * route. Handles stale (partial) states that have no `index` by mirroring
 * what React Navigation does: focus the last route in the nested list.
 *
 * Without this a cold-start from a deep link would misreport the tab root
 * as the current route while the nested state is still being hydrated,
 * which can re-enable the drawer swipe gesture or other per-route flags.
 *
 * adapted from bluesky-social/social-app src/lib/routes/helpers.ts (MIT)
 */
export function getCurrentRoute(
  state?: State,
): { name: string; params?: unknown } {
  if (!state) {
    // No state during init — assume root so guards behave conservatively.
    // 'Home' on the provider tree too, knowingly: the one caller that passes
    // state reads it as a telemetry label (Navigation.tsx screenKind), and a
    // pre-hydration frame labelled Home is harmless there.
    return { name: 'Home', params: undefined };
  }

  // `state.index || 0` matches Bluesky: when index is undefined (stale outer
  // state), start from 0 rather than the last route.
   
  let node = state.routes[state.index || 0]!;
  while (node.state?.routes) {
    const inner = node.state;
    // Inner stale states focus the last route (they have no explicit index).
    node = inner.routes[inner.index ?? inner.routes.length - 1] ?? node;
  }
  return node;
}

/**
 * True when `current` matches a tab root name in any of its three forms:
 * the root name itself (`Home`), the tab key (`HomeTab`), or the inner
 * sentinel (`HomeInner`).
 *
 * adapted from bluesky-social/social-app src/lib/routes/helpers.ts (MIT)
 */
export function isTab(current: string, route: string): boolean {
  return (
    current === route ||
    current === `${route}Tab` ||
    current === `${route}Inner`
  );
}

export enum TabState {
  InsideAtRoot,
  Inside,
  Outside,
}

/**
 * Returns the navigation state of `tab` relative to the current route:
 * - `InsideAtRoot`: the tab is focused and its own root screen is on top
 * - `Inside`: the tab is focused with something pushed above its root
 * - `Outside`: a different tab is focused
 *
 * adapted from bluesky-social/social-app src/lib/routes/helpers.ts (MIT)
 */
export function getTabState(state: State | undefined, tab: string): TabState {
  if (!state) {
    return TabState.Outside;
  }
  const currentRoute = getCurrentRoute(state);
  if (isTab(currentRoute.name, tab)) {
    return TabState.InsideAtRoot;
  }
  const activeTab = state.routes[state.index ?? 0];
  if (activeTab !== undefined && isTab(activeTab.name, tab)) {
    return TabState.Inside;
  }
  return TabState.Outside;
}
