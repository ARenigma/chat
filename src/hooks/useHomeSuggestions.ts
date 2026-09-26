/**
 * Drives the idle-home suggestion campaign (migration 126).
 *
 * Wired into HomeScreen when HOME_SUGGESTIONS_ENABLED = true. Manages:
 *   - idle timer (10 s before first prompt)
 *   - server fetch (`get_home_suggestions`)
 *   - per-prompt countdown (30 s per prompt, handled in HomeSuggestionScreen)
 *   - AppState transitions (background cancels)
 *   - suppression when a real call or chat-ring is active
 *
 * On accept, navigates to the provider's chat via `onOpenConversation`. The
 * existing `useChatOpenAlert` in ChatScreenV2 calls `announce_chat_open` and
 * dispatches the push to the provider on mount.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import type { HomeSuggestion, SuggestionOutcome } from '../api/homeSuggestions';
import { getHomeSuggestions, recordSuggestionOutcome } from '../api/homeSuggestions';
import {
  IDLE_WAIT_MS,
  transitionCampaign,
  INITIAL_STATE,
  type CampaignState,
} from '../lib/homeSuggestions';

interface Options {
  /** Suppressed while a real call or chat-request ring is active. */
  hasActiveCallOrRing: boolean;
  /**
   * Whether Home is the screen the member is on. The campaign's HOME_MOUNT and
   * HOME_UNMOUNT follow it rather than the mount (nav-migration §5): under the
   * navigator Home stays mounted beneath a pushed chat, and an idle timer
   * running there would open a prompt over the chat. The old tree passes
   * nothing, so this is `true` and the events follow the mount as before.
   */
  focused?: boolean;
  /** Navigate to the provider's chat thread on accept. */
  onOpenConversation: (providerId: string) => void;
}

interface Result {
  /** The suggestion that should be showing right now, or null. */
  currentSuggestion: HomeSuggestion | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function useHomeSuggestions({
  hasActiveCallOrRing,
  onOpenConversation,
  focused = true,
}: Options): Result {
  const [state, setState] = useState<CampaignState>(INITIAL_STATE);
  const [suggestions, setSuggestions] = useState<HomeSuggestion[]>([]);

  // Refs so timer callbacks don't need to re-subscribe.
  const stateRef = useRef(state);
  stateRef.current = state;
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;

  const dispatch = useCallback((event: Parameters<typeof transitionCampaign>[1]) => {
    setState(prev => transitionCampaign(prev, event));
  }, []);

  // Home shown / Home left. Keyed on `focused`, so a blur is a HOME_UNMOUNT
  // and a return is a fresh HOME_MOUNT, exactly as an unmount and a remount
  // were in the old tree.
  useEffect(() => {
    if (!focused) {
      return;
    }
    dispatch({ type: 'HOME_MOUNT' });
    return () => dispatch({ type: 'HOME_UNMOUNT' });
  }, [focused, dispatch]);

  // AppState transitions.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') dispatch({ type: 'APP_BACKGROUND' });
      else dispatch({ type: 'APP_FOREGROUND' });
    });
    return () => sub.remove();
  }, [dispatch]);

  // Real call/ring suppression.
  useEffect(() => {
    if (hasActiveCallOrRing) {
      dispatch({ type: 'REAL_CALL_ARRIVED' });
    }
  }, [hasActiveCallOrRing, dispatch]);

  // Idle timer fires → fetch suggestions.
  useEffect(() => {
    if (state.phase !== 'idle_wait') return;
    const id = setTimeout(() => dispatch({ type: 'IDLE_TIMER_FIRED' }), IDLE_WAIT_MS);
    return () => clearTimeout(id);
  }, [state.phase, dispatch]);

  // Fetch on entering fetching phase.
  useEffect(() => {
    if (state.phase !== 'fetching') return;
    let cancelled = false;
    getHomeSuggestions().then(rows => {
      if (cancelled) return;
      setSuggestions(rows);
      if (rows.length > 0) {
        dispatch({ type: 'SUGGESTIONS_READY', count: rows.length });
      } else {
        dispatch({ type: 'SUGGESTIONS_EMPTY' });
      }
    }).catch(() => {
      if (!cancelled) dispatch({ type: 'SUGGESTIONS_EMPTY' });
    });
    return () => { cancelled = true; };
  }, [state.phase, dispatch]);

  // Accept — navigate to the provider's chat. ChatScreenV2 handles announce_chat_open.
  const onAccept = useCallback(() => {
    if (stateRef.current.phase !== 'prompting') return;
    const idx = stateRef.current.promptIndex;
    const sugg = suggestionsRef.current[idx];
    if (!sugg) return;
    void recordSuggestionOutcome(sugg.provider_id, (idx + 1) as 1 | 2 | 3, 'accepted');
    dispatch({ type: 'CONNECT_SUCCESS' });
    // Navigate to the provider's chat; ChatScreenV2 mounts and calls
    // announce_chat_open, which sends the provider a push notification.
    onOpenConversation(sugg.provider_id);
  }, [dispatch, onOpenConversation]);

  const onDismiss = useCallback(() => {
    if (stateRef.current.phase !== 'prompting') return;
    const idx = stateRef.current.promptIndex;
    const sugg = suggestionsRef.current[idx];
    if (sugg) {
      void recordSuggestionOutcome(sugg.provider_id, (idx + 1) as 1 | 2 | 3, 'dismissed' as SuggestionOutcome);
    }
    dispatch({ type: 'MEMBER_DISMISS' });
  }, [dispatch]);

  const currentSuggestion =
    state.phase === 'prompting' && state.promptIndex < suggestions.length
      ? (suggestions[state.promptIndex] ?? null)
      : null;

  return { currentSuggestion, onAccept, onDismiss };
}
