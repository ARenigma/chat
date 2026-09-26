import { useEffect } from 'react';
import { startPresenceHeartbeat } from '../lib/presenceHeartbeat';

/**
 * Reports the signed-in provider's presence while `enabled` (migration 155).
 * Pass `role === 'provider'` from the signed-in tree; a member must never
 * mount it with true, though the server writes nothing for one either way.
 * See `src/lib/presenceHeartbeat.ts` for the rules.
 */
export function usePresenceHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return startPresenceHeartbeat();
  }, [enabled]);
}
