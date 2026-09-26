/**
 * Suppresses repeated calls within a timeout window.
 *
 * Used for tab-press navigation (250 ms default) to prevent double-navigation
 * on a fast double-tap. The hook is not appropriate for frequent user-input
 * events — use debounce for those instead.
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useDedupe.ts (MIT),
 * see THIRD_PARTY_LICENSES.md
 */

import { useCallback, useRef } from 'react';

/**
 * Returns a stable callback wrapper. When invoked:
 * - If the timeout has elapsed since the last call, invokes `cb` and returns
 *   `true`.
 * - Otherwise swallows the call and returns `false`.
 */
export function useDedupe(timeout = 250): (cb: () => unknown) => boolean {
  const canDo = useRef(true);

  return useCallback(
    (cb: () => unknown): boolean => {
      if (canDo.current) {
        canDo.current = false;
        setTimeout(() => {
          canDo.current = true;
        }, timeout);
        cb();
        return true;
      }
      return false;
    },
    [timeout],
  );
}
