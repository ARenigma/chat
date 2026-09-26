/**
 * The measured height of the bottom bar, shared with everything that has to
 * sit above it (UpdateBanner, the minimal-shell translate).
 *
 * A shared value, not React state: the bar writes it from `onLayout` and the
 * readers consume it inside worklets, so a height change never re-renders a
 * screen.
 *
 * adapted from bluesky-social/social-app src/state/shell/shell-layout.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md. Bluesky also carries a `headerHeight`; nothing
 * here reads one, so it is not ported.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { type SharedValue, useSharedValue } from 'react-native-reanimated';

interface ShellLayout {
  /** The bar's laid-out height in dp, hairline and inset included. 0 while unmounted. */
  footerHeight: SharedValue<number>;
}

const ShellLayoutContext = createContext<ShellLayout | null>(null);
ShellLayoutContext.displayName = 'ShellLayoutContext';

export function ShellLayoutProvider({ children }: { children: ReactNode }) {
  const footerHeight = useSharedValue(0);
  const value = useMemo(() => ({ footerHeight }), [footerHeight]);
  return <ShellLayoutContext.Provider value={value}>{children}</ShellLayoutContext.Provider>;
}

export function useShellLayout(): ShellLayout {
  const context = useContext(ShellLayoutContext);
  if (context === null) {
    throw new Error('useShellLayout must be used within ShellStateProvider');
  }
  return context;
}
