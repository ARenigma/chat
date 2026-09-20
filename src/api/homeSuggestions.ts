/**
 * Idle-home provider suggestion campaign (migration 126).
 *
 * When `HOME_SUGGESTIONS_ENABLED` is true and the member idles for 10 s,
 * the app calls `getHomeSuggestions()` to pre-fetch up to 3 provider candidates.
 * The app then shows them one at a time, 10 s apart, as a "calling"-style prompt.
 */
import { supabase } from '../lib/supabase';

export interface HomeSuggestion {
  provider_id: string;
  display_name: string;
  avatar_url: string | null;
  headline: string | null;
}

/**
 * Fetch up to 3 distinct available providers for one idle-home campaign.
 * Returns [] when the member has no balance, is not a member, or no providers
 * qualify. Server gates: balance, no active call/session, not blocked, not
 * shown within 2 hours.
 */
export async function getHomeSuggestions(): Promise<HomeSuggestion[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_home_suggestions');
  if (error) return [];
  return (data as unknown as HomeSuggestion[] | null) ?? [];
}

export type SuggestionOutcome = 'accepted' | 'declined' | 'expired' | 'dismissed';

/**
 * Record the outcome of a suggestion prompt.  Fire-and-forget: an analytics
 * failure should never block the UI.
 */
export async function recordSuggestionOutcome(
  providerId: string,
  promptNumber: 1 | 2 | 3,
  outcome: SuggestionOutcome,
  conversationId?: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('record_suggestion_outcome', {
    p_provider_id:    providerId,
    p_prompt_number:  promptNumber,
    p_outcome:        outcome,
    p_conversation_id: conversationId ?? null,
  }).catch(() => undefined);
}
