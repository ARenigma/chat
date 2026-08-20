/**
 * The provider side: applying, knowing where the application stands, going
 * available, and seeing what has been earned.
 *
 * The design constraint that shapes all of it comes from Clarity's own store
 * reviews — a listener stuck for two weeks on "Profile Under Review / Something
 * Missing", contacting support repeatedly, getting nothing, and eventually
 * saying so publicly under a listing that demand also reads. Supply churn is not
 * a private failure.
 *
 * So: `missing_fields` is computed server-side and surfaced verbatim, the status
 * is a real enum rather than a vibe, and `needs_info` is resolvable by the
 * applicant alone.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type {
  Gender,
  MyApplication,
  Profile,
  ProviderEarnings,
} from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
import { useStore } from '../store/useStore';
import { keys } from './chat';

export const providerKeys = {
  application: ['my-application'] as const,
  earnings: ['provider-earnings'] as const,
};

export interface ApplicationDraft {
  displayName: string;
  gender: Gender | null;
  /** ISO date. The gate is enforced in SQL, not here. */
  dateOfBirth: string | null;
  headline: string;
  languages: string[];
  about: string;
}

/** Null when this account has never applied. */
export function useMyApplication() {
  return useQuery<MyApplication | null>({
    queryKey: providerKeys.application,
    queryFn: async () => {
      const { data, error } = await supabase.from('my_application').select('*').limit(1);
      if (error) {
        throw new Error(error.message);
      }
      return data.length > 0 ? (data[0] as MyApplication) : null;
    },
  });
}

/**
 * Submit or resubmit. Returns the fields still missing, so the form can mark
 * them immediately rather than showing a generic failure.
 */
export function useSubmitApplication() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<string[], Error, ApplicationDraft>({
    mutationFn: async draft => {
      const { data, error } = await supabase.rpc('submit_provider_application', {
        p_display_name: draft.displayName,
        p_gender: draft.gender,
        p_date_of_birth: draft.dateOfBirth,
        p_headline: draft.headline,
        p_languages: draft.languages,
        p_about: draft.about,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data ?? [];
    },
    onSuccess: missing => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.application });
      if (missing.length === 0) {
        tick();
        setNotice('Application submitted. We will be in touch.');
      }
    },
    onError: err => {
      errorTick();
      // The 18+ refusal comes back as a server error and is worth showing
      // plainly rather than as "something went wrong" — it is not retryable.
      setNotice(
        /18 or older/.test(err.message)
          ? 'You must be 18 or older to be a provider.'
          : 'Could not submit right now.',
      );
    },
  });
}

/**
 * The availability toggle. `is_available` is an ordinary profile column a
 * provider owns — deliberately not guarded, because being reachable or not is
 * the one thing about their own listing they should control instantly.
 */
export function useSetAvailability() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, boolean>({
    mutationFn: async available => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase
        .from('profiles')
        .update({ is_available: available })
        .eq('id', me);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: () => {
      errorTick();
      setNotice('Could not change your availability.');
    },
  });
}

export function useEarnings() {
  return useQuery<ProviderEarnings | null>({
    queryKey: providerKeys.earnings,
    queryFn: async () => {
      const { data, error } = await supabase.from('provider_earnings').select('*').limit(1);
      if (error) {
        throw new Error(error.message);
      }
      return data.length > 0 ? (data[0] as ProviderEarnings) : null;
    },
    staleTime: 60_000,
  });
}

/** A member rating a finished conversation. One per thread, member only. */
export function useSubmitReview() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, { conversationId: string; rating: number; comment: string | null }>(
    {
      mutationFn: async input => {
        const { error } = await supabase.rpc('submit_review', {
          p_conversation_id: input.conversationId,
          p_rating: input.rating,
          p_comment: input.comment,
        });
        if (error) {
          throw new Error(error.message);
        }
      },
      onSuccess: (_void, input) => {
        tick();
        // Rating is a 1..5 integer, so it is safe as a telemetry dimension; the
        // free-text comment never is.
        track('review_submitted', { rating: input.rating });
        setNotice('Thanks — that helps the next person choose.');
        void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      },
      onError: err => {
        errorTick();
        setNotice(
          /nothing to review/.test(err.message)
            ? 'Have a conversation first, then you can rate it.'
            : 'Could not save that rating.',
        );
      },
    },
  );
}

/** The signed-in profile's role, which selects the navigation root. */
export function useRole(): { role: Profile['role'] | undefined; isPending: boolean } {
  const { data, isPending } = useQuery<Profile>({
    queryKey: keys.profile,
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      const id = user.user?.id;
      if (id === undefined) {
        throw new Error('No session');
      }
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', id)
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return profile;
    },
    staleTime: 15_000,
  });
  return { role: data?.role, isPending };
}
