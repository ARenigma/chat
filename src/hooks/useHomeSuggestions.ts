/**
 * Drives the idle-home suggestion campaign (migration 126).
 *
 * Wired into HomeScreen when HOME_SUGGESTIONS_ENABLED = true. Manages:
 *   - idle timer (10 s before first prompt)
 *   - server fetch (`get_home_suggestions`)
 *   - per-prompt countdown (30 s per prompt, handled in HomeSuggestionPrompt)
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

  // Mount/unmount — called by HomeScreen's useEffect.
  useEffect(() => {
    dispatch({ type: 'HOME_MOUNT' });
    return () => dispatch({ type: 'HOME_UNMOUNT' });
  }, [dispatch]);

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
