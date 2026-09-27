/**
 * Whether a chat is in use (nav-migration §5, ruling 9).
 *
 * Lifetime parity with the old tree, where a covered chat unmounted: under a
 * Call, a ProviderDetail or the provider's Usage it stopped billing, and under
 * the Wallet page and the ring (which were overlays) it kept going. So a chat
 * is live only while its TAB is focused and every route above it in its own
 * stack is one of those old overlays. A chat in an unfocused tab is not in
 * use, and stops billing as an unmount stopped it before. Changing that is a
 * product decision, not a navigation one.
 */

import { useContext } from 'react';
import { useNavigationState, useRoute } from '@react-navigation/native';

import { TabFocusedContext } from './tabFocus';

/** Screens that were overlays over a mounted chat in the old tree. */
const KEEP_ALIVE_ABOVE: ReadonlySet<string> = new Set(['Wallet', 'ChatRequest']);

export function useChatLive(): boolean {
  const tabFocused = useContext(TabFocusedContext);
  const key = useRoute().key;
  const onlyOverlaysAbove = useNavigationState(state => {
    const at = state.routes.findIndex(r => r.key === key);
    return state.routes.slice(at + 1).every(r => KEEP_ALIVE_ABOVE.has(r.name));
  });
  return tabFocused && onlyOverlaysAbove;
}
