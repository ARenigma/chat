/**
 * The idle-home prompt that is up right now, handed from Home (whose
 * `useHomeSuggestions` owns the campaign) to the `HomeSuggestion` route that
 * shows it (nav-migration §2). Home stays mounted under the route, so the
 * campaign keeps running there; this is only the seam between the two.
 * Null when no prompt is up. Only ever written while
 * HOME_SUGGESTIONS_ENABLED is true.
 */

import { create } from 'zustand';

import type { HomeSuggestion } from '../api/homeSuggestions';

export interface HomeSuggestionPrompt {
  suggestion: HomeSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}

interface State {
  prompt: HomeSuggestionPrompt | null;
  setPrompt: (prompt: HomeSuggestionPrompt | null) => void;
}

export const useHomeSuggestionPrompt = create<State>(set => ({
  prompt: null,
  setPrompt: prompt => set({ prompt }),
}));
