/**
 * The provider side: applying, knowing where the application stands, going
 * available, and seeing what has been earned.
 *
 * The design constraint that shapes all of it comes from Clarity's own store
 * reviews, a listener stuck for two weeks on "Profile Under Review / Something
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
import { ENV } from '../lib/env';
import type {
  Gender,
  MyApplication,
  PresenceChoice,
  Profile,
  ProviderEarnings,
} from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
import { useStore } from '../store/useStore';
import { keys, useProfile } from './chat';

export const providerKeys = {
  application: ['my-application'] as const,
  earnings: ['provider-earnings'] as const,
  payoutAccount: ['provider-payout-account'] as const,
  payoutReadiness: ['provider-payout-readiness'] as const,
  tax: ['provider-tax-profile'] as const,
};

export type PayoutMethod = 'upi' | 'bank';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed';

/** A provider's saved payout destination (client-safe columns only). */
export interface PayoutAccount {
  id: string;
  method: PayoutMethod;
  upi_vpa: string | null;
  account_number: string | null;
  ifsc: string | null;
  account_holder_name: string | null;
  verification_status: VerificationStatus;
  name_at_bank: string | null;
  verification_error: string | null;
}

export interface PayoutReadiness {
  payout_account_verified: boolean;
  can_go_live: boolean;
}

export interface TaxProfile {
  pan: string | null;
  pan_name: string | null;
  status: 'not_provided' | 'pending' | 'verified' | 'failed';
  failure_reason: string | null;
}

export interface PayoutAccountDraft {
  method: PayoutMethod;
  upiVpa?: string;
  accountNumber?: string;
  ifsc?: string;
  accountHolderName?: string;
}

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
        setNotice('Application submitted. We will be in touch.', 'confirm');
      }
    },
    onError: err => {
      errorTick();
      // The 18+ refusal comes back as a server error and is worth showing
      // plainly rather than as "something went wrong", it is not retryable.
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
 * provider owns, deliberately not guarded, because being reachable or not is the
 * one thing about their own listing they should control instantly.
 *
 * It is the LISTING switch and nothing else, as of 012: listed for discovery and
 * open to new conversations. It used to double as the presence dot in four
 * places, which meant a provider who wanted work but had put the phone down
 * still read as here. Presence is `useSetPresence` below.
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

/**
 * Presence, which is a different question from availability and used to be the
 * same column.
 *
 * Both roles get this, which is why it lives beside the provider writes rather
 * than in a module of its own: this file already owns every profile write, and
 * splitting one PATCH across two modules by role would be the only reason to
 * have a second.
 *
 * Two columns, one UPDATE, because there is one decision. Migration 011 stored
 * `presence_visible` as the gate on the last-seen stamp and 012 added `presence`
 * as the declared state; keeping them independent in the schema is right (the
 * stamp has its own guard, and 011's tests pin it), but offering the user two
 * switches for one thought is not. Hidden means publish nothing, so hidden also
 * closes the stamp. `readPresence` ignores a stamp that contradicts a hidden
 * choice anyway, so a half-applied write fails closed rather than leaking.
 */
export function useSetPresence() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, PresenceChoice>({
    mutationFn: async presence => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase
        .from('profiles')
        .update({ presence, presence_visible: presence !== 'hidden' })
        .eq('id', me);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: (_void, presence) => {
      tick();
      track('presence_changed', { choice: presence });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
      // The peer's inbox reads `conversation_summaries.peer_presence`, so this is
      // the one invalidation that is about somebody else's screen rather than
      // this one. It only refreshes the caller's own copy, but a provider who
      // just went away is usually looking at their own inbox when they do it.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    },
    onError: () => {
      errorTick();
      setNotice('Could not change your presence.');
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

// ---------------------------------------------------------------------------
// Payout account + PAN. The client only ever SAVES raw details (RPCs) and asks
// for verification (Edge functions); the verified state is written server-side
// (migration 048), so a hook can never fake a "verified" account.
// ---------------------------------------------------------------------------

/** The provider's default payout destination, or null if none saved yet. */
export function usePayoutAccount() {
  return useQuery<PayoutAccount | null>({
    queryKey: providerKeys.payoutAccount,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_payout_accounts')
        .select(
          'id, method, upi_vpa, account_number, ifsc, account_holder_name, verification_status, name_at_bank, verification_error',
        )
        .eq('is_default', true)
        .limit(1);
      if (error) {
        throw new Error(error.message);
      }
      return data.length > 0 ? (data[0] as PayoutAccount) : null;
    },
    staleTime: 30_000,
  });
}

/** Whether the provider is payout-ready (the ADR-0022 listing gate). */
export function usePayoutReadiness() {
  return useQuery<PayoutReadiness | null>({
    queryKey: providerKeys.payoutReadiness,
    queryFn: async () => {
      const { data, error } = await supabase.from('my_payout_readiness').select('*').limit(1);
      if (error) {
        throw new Error(error.message);
      }
      return data.length > 0 ? (data[0] as PayoutReadiness) : null;
    },
    staleTime: 30_000,
  });
}

/** The provider's PAN/tax status (tax only, not KYC). */
export function useTaxProfile() {
  return useQuery<TaxProfile | null>({
    queryKey: providerKeys.tax,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_tax_profile')
        .select('pan, pan_name, status, failure_reason')
        .limit(1);
      if (error) {
        throw new Error(error.message);
      }
      return data.length > 0 ? (data[0] as TaxProfile) : null;
    },
    staleTime: 30_000,
  });
}

/** Save a bank/UPI destination (always unverified) then trigger verification. */
export function useSavePayoutAccount() {
  const queryClient = useQueryClient();
  return useMutation<VerificationStatus, Error, PayoutAccountDraft>({
    mutationFn: async draft => {
      const { error: rpcErr } = await supabase.rpc('upsert_my_payout_account', {
        p_method: draft.method,
        p_upi_vpa: draft.method === 'upi' ? (draft.upiVpa ?? null) : null,
        p_account_number: draft.method === 'bank' ? (draft.accountNumber ?? null) : null,
        p_ifsc: draft.method === 'bank' ? (draft.ifsc ?? null) : null,
        p_account_holder_name: draft.accountHolderName ?? null,
      });
      if (rpcErr) {
        throw new Error(rpcErr.message);
      }
      // Ask the Edge function to create + verify the Cashfree beneficiary.
      const { data, error } = await supabase.functions.invoke('verify-payout-account', {
        body: {},
      });
      if (error) {
        throw new Error(error.message);
      }
      const status = (data as { status?: VerificationStatus })?.status ?? 'pending';
      if (status === 'verified') {
        tick();
      } else {
        errorTick();
      }
      return status;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.payoutAccount });
      void queryClient.invalidateQueries({ queryKey: providerKeys.payoutReadiness });
    },
  });
}

/** Save a PAN (format-checked in SQL) then trigger Cashfree verification. */
export function useSavePan() {
  const queryClient = useQueryClient();
  return useMutation<'verified' | 'failed', Error, string>({
    mutationFn: async pan => {
      const { error: rpcErr } = await supabase.rpc('set_my_pan', { p_pan: pan });
      if (rpcErr) {
        throw new Error(rpcErr.message);
      }
      const { data, error } = await supabase.functions.invoke('verify-pan', { body: {} });
      if (error) {
        throw new Error(error.message);
      }
      const status = (data as { status?: 'verified' | 'failed' })?.status ?? 'failed';
      if (status === 'verified') {
        tick();
      } else {
        errorTick();
      }
      return status;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.tax });
    },
  });
}

/**
 * Upload a directory photo. Public `avatars` bucket; path `{uid}/{uuid}.jpg`.
 * Uses the same FormData uri branch as chat attachments (RN FormData has no
 * `has()`), then writes the public URL onto `profiles.avatar_url`.
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, { uri: string; mime?: string }>({
    mutationFn: async ({ uri, mime = 'image/jpeg' }) => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      const session = (await supabase.auth.getSession()).data.session;
      if (me === undefined || session?.access_token === undefined) {
        throw new Error('No session');
      }

      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const path = `${me}/${Date.now()}.${ext}`;
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', {
        uri: uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}`,
        name: `avatar.${ext}`,
        type: mime,
      } as unknown as Blob);

      const response = await fetch(
        `${ENV.supabaseUrl}/storage/v1/object/avatars/${path}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: ENV.supabaseAnonKey,
            'x-upsert': 'true',
          },
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error('UPLOAD');
      }

      const publicUrl = `${ENV.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', me);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      setNotice('Photo updated. Members will see it in the directory.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: () => {
      errorTick();
      setNotice('Could not update your photo. Try again.');
    },
  });
}

/**
 * Clear the profile photo. Both roles, like useUploadAvatar. The storage object
 * is left for the orphan-purge cron; only the `avatar_url` pointer is nulled,
 * which is what every reader keys off. `avatar_url` is not a privileged column
 * (guard_privileged_profile_columns), so the owner's own RLS update applies.
 */
export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', me);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      setNotice('Photo removed.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: () => {
      errorTick();
      setNotice('Could not remove your photo. Try again.');
    },
  });
}

/**
 * Set the profile photo to a bundled DiceBear "clay" avatar. Writes the
 * `clay:<seed>` sentinel onto `avatar_url`; every reader resolves it through
 * `resolveAvatarSource`. No upload, no storage object — the art ships in the app.
 * Same RLS path as useRemoveAvatar (avatar_url is not a privileged column).
 */
export function useSetClayAvatar() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, string>({
    mutationFn: async (seed: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: `clay:${seed}` })
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
      setNotice('Could not update your avatar. Try again.');
    },
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
        setNotice('Thanks, that helps the next person choose.', 'confirm');
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

/**
 * The signed-in profile's role, which selects the navigation root.
 *
 * Delegates to `useProfile` rather than running its own query. It previously
 * declared a *second* queryFn against the same `keys.profile` key, which React
 * Query resolves by whichever observer mounts first, so the behaviour depended
 * on render order. Two functions fighting over one cache key is a bug whether or
 * not it is the one currently visible.
 */
export function useRole(): { role: Profile['role'] | undefined; isPending: boolean } {
  const { data, isPending } = useProfile();
  return { role: data?.role, isPending };
}
