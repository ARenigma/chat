/**
 * Re-selecting the tab you are on scrolls its root back to the top.
 *
 * M3 navigation bar: "Tapping a destination that is already selected ...
 * scrolls the content to the top" (https://m3.material.io/components/navigation-bar/guidelines).
 * BottomBar emits the soft reset only when the tab is already at its root
 * (nav-migration §6), so a listener here only has to be the focused screen's.
 *
 * Focus-scoped: a tab root that is not the focused screen hears nothing, and a
 * caller can narrow it further with `enabled` (Home's settled category page,
 * search open or not). The handler is read through a ref, so a caller can pass
 * an inline function without re-subscribing every render.
 *
 * adapted from bluesky-social/social-app src/state/events.ts listeners (MIT),
 * see THIRD_PARTY_LICENSES.md
 */
import { useEffect, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { listenSoftReset } from '../events';

export function useSoftReset(onReset: () => void, enabled: boolean = true): void {
  const focused = useIsFocused();
  const handler = useRef(onReset);
  handler.current = onReset;
  useEffect(() => {
    if (!focused || !enabled) {
      return;
    }
    return listenSoftReset(() => handler.current());
  }, [focused, enabled]);
}
