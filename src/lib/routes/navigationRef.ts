/**
 * Module-level reference to the NavigationContainer.
 *
 * Any module (intent queue, link parser, Sentry breadcrumbs) can navigate
 * imperatively without prop-drilling or a context import.
 *
 * adapted from bluesky-social/social-app src/lib/routes/helpers.ts (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import { createNavigationContainerRef } from '@react-navigation/native';

import type { AllNavigatorParams } from './types';

export const navigationRef =
  createNavigationContainerRef<AllNavigatorParams>();

/** Name of the currently focused route, or 'Home' when not yet ready. */
export function getCurrentRouteName(): string {
  if (!navigationRef.isReady()) {
    return 'Home';
  }
  return navigationRef.getCurrentRoute()?.name ?? 'Home';
}

/** Root navigator state, or undefined when not yet ready. */
export function getRootState():
  | ReturnType<typeof navigationRef.getRootState>
  | undefined {
  if (!navigationRef.isReady()) {
    return undefined;
  }
  return navigationRef.getRootState();
}
