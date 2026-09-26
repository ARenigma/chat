/**
 * Every in-app chat opener: a Home card, a ChatsList row, the provider's
 * Chats and Saved rows. Through `resolveOpenChat`, so an open for a peer
 * whose chat is already mounted in any tab returns to it instead of stacking
 * a second copy (nav-migration §3, A6), and deduped 250ms so a double tap
 * opens once.
 */

import { useCallback } from 'react';

import { useDedupe } from './useDedupe';
import { openChat, type ChatOrigin } from '../lib/routes/actions';
import { track } from '../lib/telemetry';

export function useOpenChat(origin: ChatOrigin = 'inApp'): (peerId: string, sourceKey?: string) => void {
  const dedupe = useDedupe();
  return useCallback(
    (peerId: string, sourceKey?: string) => {
      dedupe(() => {
        track('conversation_opened');
        openChat(peerId, origin, sourceKey);
      });
    },
    [dedupe, origin],
  );
}
