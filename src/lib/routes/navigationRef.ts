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

