/**
 * The shell's state, hoisted above the navigator (nav-migration §1) so the
 * UpdateBanner, which lives outside every route, can ride above the bar.
 *
 * adapted from bluesky-social/social-app src/state/shell/index.tsx (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import React, { type ReactNode } from 'react';
import { MinimalModeProvider } from './minimalMode';
import { ShellLayoutProvider } from './shellLayout';

export function ShellStateProvider({ children }: { children: ReactNode }) {
  return (
    <ShellLayoutProvider>
      <MinimalModeProvider>{children}</MinimalModeProvider>
    </ShellLayoutProvider>
  );
}
