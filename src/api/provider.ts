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
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import type {
  Gender,
  MyApplication,
  Profile,
  ProviderEarnings,
  ProviderPhoto,
  ProviderRatings,
} from '../lib/database.types';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
import {
  ContactGuardRefusalError,
  contactGuardRefusalFromError,
} from '../lib/contactGuard';
import {
  cashfreeOnboardingAvailable,
  CashfreeOnboardingError,
  startCashfreeOnboarding,
} from '../lib/cashfreeOnboarding';
import { useStore } from '../store/useStore';
import { keys, useProfile } from './chat';
import type { ProviderCategory } from '../lib/providerFilters';

export const providerKeys = {
  application: ['my-application'] as const,
  earnings: ['provider-earnings'] as const,
  payoutAccount: ['provider-payout-account'] as const,
  payoutReadiness: ['provider-payout-readiness'] as const,
  tax: ['provider-tax-profile'] as const,
  /** One gallery per provider, so the id is part of the key (migration 070). */
  photos: (providerId: string) => ['provider-photos', providerId] as const,
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
  /** PAN is mandatory (migration 049): both must be true to go live. */
  pan_verified: boolean;
  can_go_live: boolean;
}

export interface TaxProfile {
  pan: string | null;
  pan_name: string | null;
  /**
   * Date of birth as returned by the PAN check, `YYYY-MM-DD`.
   *
   * Held here rather than on `profiles` until promotion, because
   * `member_is_pseudonymous` (migration 011) forbids a birth date on a member
   * row. Read by onboarding to SHOW the provider what was fetched before they
   * confirm it, and by `complete_provider_onboarding` for the 18+ gate.
   */
  verified_dob: string | null;
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
        err instanceof ContactGuardRefusalError
          ? err.message
          : /18 or older/.test(err.message)
          ? 'You must be 18 or older to be a provider.'
          : 'Could not submit right now.',
      );
    },
  });
}

export interface ProviderProfileDraft {
  displayName: string;
  headline: string;
  languages: string[];
  about: string;
  /** listener | astrologer (migration 065); chosen once, on the profile step. */
  category: ProviderCategory;
  /**
   * Topic tags (migration 083). Written by a SECOND call, not by
   * `complete_provider_onboarding` — see the mutation below for why the order
   * of the two is forced rather than incidental.
   */
  expertise: string[];
}

/**
 * Whether a write failed because the display name is already held.
 *
 * Matched on the constraint name rather than the message text, which is
 * Postgres's and not ours to depend on.
 */
export function isDuplicateDisplayName(message: string): boolean {
  return /profiles_display_name_lower_unique/.test(message);
}

/**
 * Auto-onboard: go live as a provider in one call (migration 051).
 *
 * Replaces the apply → admin-review path. The provider has already verified
 * identity + PAN + bank through the Cashfree 1-Click step (which set their DOB),
 * so this sets `role = 'provider'` + `identity_verified_at` and copies the profile
 * fields. The role flip re-renders the app into the provider tree — there is no
 * separate "go to provider home" navigation, the tree selection is by role.
 */
export function useCompleteProviderOnboarding() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, ProviderProfileDraft>({
    mutationFn: async draft => {
      const { error } = await supabase.rpc('complete_provider_onboarding', {
        p_display_name: draft.displayName,
        p_headline: draft.headline,
        p_languages: draft.languages,
        p_about: draft.about,
        p_provider_category: draft.category,
      });
      if (error) {
        const refusal = contactGuardRefusalFromError(error);
      if (refusal) {
        throw new ContactGuardRefusalError(refusal);
      }
      throw new Error(error.message);
      }

      /*
       * Tags go SECOND, and the order is forced rather than stylistic.
       *
       * `set_provider_expertise` refuses anyone whose role is not 'provider',
       * and the call above is what flips it. Reversed, this would fail every
       * time with "only a provider has expertise" — which is the correct
       * refusal for a member and the wrong one here.
       *
       * Two calls, because 083 deliberately did not append a parameter to the
       * 72-line onboarding function: appending would have made its existing
       * 5-arg signature ambiguous (065's finding) and dropping-to-recreate
       * would have meant reproducing a body that gates identity, DOB and 18+
       * (054's failure). The migration header carries the full argument.
       *
       * NOT FATAL IF IT FAILS. The provider is already live at this point —
       * role is flipped, the directory row exists, they can be messaged. Tags
       * are discovery polish, and throwing here would show "Could not finish
       * setup" to somebody whose setup finished, and invite a retry that
       * re-runs the onboarding call. So it is logged and swallowed; the
       * provider edits their tags later, and every row already renders the
       * empty case (083 seeds a provider with none for exactly this reason).
       */
      if (draft.expertise.length > 0) {
        const { error: tagError } = await supabase.rpc('set_provider_expertise', {
          p_expertise: draft.expertise,
        });
        if (tagError !== null) {
          console.warn(`provider: tags not saved during onboarding: ${tagError.message}`);
        }
      }
    },
    onSuccess: () => {
      tick();
      // Role is now 'provider'; useRole re-reads and App renders the provider tree.
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: err => {
      errorTick();
      setNotice(
        /18 or older/.test(err.message)
          ? 'You must be 18 or older to be a provider.'
          : /verify your identity/.test(err.message)
            ? 'Please verify your identity first.'
            : /*
               * Display names are unique across every profile
               * (`profiles_display_name_lower_unique`), so a provider can pick a
               * stage name a member already holds. "Please try again" was a dead
               * end for exactly this case: the retry it asks for fails forever.
               */
              isDuplicateDisplayName(err.message)
              ? 'That name is already taken. Pick another one.'
              : 'Could not finish setup. Please try again.',
      );
    },
  });
}

/** The three channel switches, as the provider sets them (migration 064). */
export interface ProviderChannels {
  chat_enabled: boolean;
  audio_enabled: boolean;
  video_enabled: boolean;
}

/**
 * Turn a channel on or off.
 *
 * A direct column write, like `useSetAvailability` above: these are the
 * provider's own columns and are deliberately outside
 * `guard_privileged_profile_columns` (063). The database holds the floor —
 * `profiles_at_least_one_channel` refuses the update that would leave a
 * provider offering nothing — so the last switch is disabled in the UI as
 * courtesy, not as the rule.
 */
export function useSetChannels() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, Partial<ProviderChannels>>({
    mutationFn: async patch => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase.from('profiles').update(patch).eq('id', me);
      if (error) {
        const refusal = contactGuardRefusalFromError(error);
      if (refusal) {
        throw new ContactGuardRefusalError(refusal);
      }
      throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: err => {
      errorTick();
      setNotice(
        err instanceof ContactGuardRefusalError ? err.message : 'Could not change what you offer.',
      );
    },
  });
}

/**
 * A provider replaces their own topic tags (migration 083).
 *
 * Through the RPC rather than a direct PATCH, unlike `useSetChannels` next
 * door, and the difference is worth stating because the two look alike. RLS
 * would permit the PATCH — `expertise` is provider-owned and deliberately
 * absent from the 063 guard — but the CHECK behind it reports a constraint
 * name, and "profiles_expertise_sane" is not something a caller can act on.
 * The function restates the rule as a sentence and returns what it stored, so
 * the client renders the server's answer instead of its own optimism.
 */
export function useSetProviderExpertise() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<string[], Error, string[]>({
    mutationFn: async expertise => {
      const { data, error } = await supabase.rpc('set_provider_expertise', {
        p_expertise: expertise,
      });
      if (error) {
        const refusal = contactGuardRefusalFromError(error);
      if (refusal) {
        throw new ContactGuardRefusalError(refusal);
      }
      throw new Error(error.message);
      }
      return data ?? [];
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: err => {
      errorTick();
      setNotice(
        err instanceof ContactGuardRefusalError ? err.message : 'Could not save what you help with.',
      );
    },
  });
}

/**
 * The master switch. `is_available` is an ordinary profile column a provider
 * owns, deliberately not guarded, because being reachable or not is the one
 * thing about their own listing they must be able to change instantly.
 *
 * It was the LISTING switch and nothing else between 012 and 2026-09-17, with
 * `presence` declared separately. It is now both: off is offline everywhere and
 * the Notify route, on is online offering the channels in `useSetChannels`. See
 * src/lib/presence.ts for why collapsing the two is not the overload 012 fixed.
 */
/**
 * Keyed so `useIsMutating` can see a write in flight from EITHER availability
 * switch. Since the provider split the Chats header and the You card each hold
 * their own `useSetAvailability()` observer, and a switch that stays enabled
 * while the other screen's write is pending is a double write the single
 * instance used to prevent.
 */
export const SET_AVAILABILITY_KEY = ['setAvailability'] as const;

export function useSetAvailability() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, boolean>({
    mutationKey: SET_AVAILABILITY_KEY,
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
      // The inbox dot reads `conversation_summaries.peer_available` since
      // 2026-09-17, so this switch now moves a list the picker it replaced used
      // to move. It only refreshes the caller's own copy, but a provider who
      // just closed up is usually looking at their own inbox when they do it.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    },
    onError: () => {
      errorTick();
      setNotice('Could not change your availability.');
    },
  });
}

/*
 * `useSetPresence` WAS HERE, and is gone as of 2026-09-17.
 *
 * It wrote `profiles.presence` and `presence_visible` for the Settings picker,
 * which no longer exists: availability is the master switch and the only
 * reachability signal anyone declares or reads (src/lib/presence.ts). The
 * columns, the enum and `touch_presence()` are all still in the schema and are
 * simply unread — removing the control is not the same as destroying the data,
 * and dropping them is a later cleanup once this has been live for a while.
 */

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
        .select('pan, pan_name, verified_dob, status, failure_reason')
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
      // The details are now SAVED. Ask the Edge function to create + verify the
      // Cashfree beneficiary — but best-effort: while Cashfree Payouts is not yet
      // enabled the function is absent / returns an error, and the account simply
      // stays unverified ('pending') rather than losing the save. See
      // docs/provider-payouts.md ("Enabling verification").
      try {
        const { data, error } = await supabase.functions.invoke('verify-payout-account', {
          body: {},
        });
        if (error) {
          return 'pending';
        }
        const status = (data as { status?: VerificationStatus })?.status ?? 'pending';
        if (status === 'verified') {
          tick();
        } else {
          errorTick();
        }
        return status;
      } catch {
        return 'pending';
      }
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
  return useMutation<'verified' | 'failed' | 'pending', Error, string>({
    mutationFn: async pan => {
      const { error: rpcErr } = await supabase.rpc('set_my_pan', { p_pan: pan });
      if (rpcErr) {
        throw new Error(rpcErr.message);
      }
      // Best-effort verification (see useSavePayoutAccount): while Cashfree
      // verification is not enabled the PAN stays 'pending' rather than failing.
      try {
        const { data, error } = await supabase.functions.invoke('verify-pan', { body: {} });
        if (error) {
          return 'pending';
        }
        const status = (data as { status?: 'verified' | 'failed' })?.status ?? 'pending';
        if (status === 'verified') {
          tick();
        } else {
          errorTick();
        }
        return status;
      } catch {
        return 'pending';
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.tax });
    },
  });
}

/** Whether the native Cashfree sheet exists in this build (false in Jest). */
export function cashfreeVerificationAvailable(): boolean {
  return cashfreeOnboardingAvailable();
}

/**
 * How a 1-Click attempt ended, for the screen to react to.
 *
 * `cancelled` is not an error and stays silent — someone closed the sheet.
 * `pending` means the consent + auth_code succeeded but the server could not
 * finalize (e.g. `cashfree-onboarding-complete` not deployed yet), so the details
 * are in flight rather than lost. `unavailable` falls back to the manual form.
 */
export type CashfreeVerifyOutcome =
  | 'verified'
  | 'pending'
  | 'cancelled'
  | 'unavailable';

/**
 * The 1-Click Onboarding flow, end to end from the button:
 *   1. `cashfree-onboarding-start` mints a session (server, provider JWT).
 *   2. The native SDK opens the Cashfree sheet on that session; the user
 *      consents once (mobile OTP) and we get a one-time `authCode`.
 *   3. `cashfree-onboarding-complete` exchanges it server-side for the verified
 *      PAN + bank and writes them (the client never sees the KYC data).
 *
 * Best-effort at the edges for the same reason as `useSavePan`: a missing native
 * module or an undeployed `complete` must not lose a consent the user already
 * gave, so those land as `unavailable` / `pending` rather than a hard failure.
 * See docs/provider-payouts.md.
 */
export function useCashfreeVerification() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<CashfreeVerifyOutcome, Error, void>({
    mutationFn: async () => {
      if (!cashfreeOnboardingAvailable()) {
        return 'unavailable';
      }

      // 1. Mint a session server-side.
      const { data: startData, error: startErr } = await supabase.functions.invoke(
        'cashfree-onboarding-start',
        { body: {} },
      );
      const start = startData as
        | { sessionId?: string; environment?: 'sandbox' | 'production' }
        | null;
      if (startErr || !start?.sessionId) {
        throw new Error('start');
      }

      // 2. Open the native sheet; the auth_code comes back on consent.
      let authCode: string;
      try {
        const result = await startCashfreeOnboarding(
          start.sessionId,
          start.environment ?? 'sandbox',
        );
        authCode = result.authCode;
      } catch (err) {
        if (err instanceof CashfreeOnboardingError) {
          if (err.reason === 'cancelled') {
            return 'cancelled';
          }
          if (err.reason === 'unavailable') {
            return 'unavailable';
          }
        }
        throw err instanceof Error ? err : new Error('sheet');
      }

      // 3. Exchange + persist server-side. Best-effort: while `complete` is not
      // deployed this returns an error and the consent lands as 'pending'.
      try {
        const { data, error } = await supabase.functions.invoke(
          'cashfree-onboarding-complete',
          { body: { authCode } },
        );
        if (error) {
          return 'pending';
        }
        return (data as { status?: string })?.status === 'verified' ? 'verified' : 'pending';
      } catch {
        return 'pending';
      }
    },
    onSuccess: outcome => {
      if (outcome === 'verified') {
        tick();
        setNotice('Verified with Cashfree.', 'confirm');
      } else if (outcome === 'pending') {
        tick();
        setNotice('Details received. Verification is being finalised.', 'confirm');
      } else if (outcome === 'unavailable') {
        setNotice('Cashfree verification is not available here. Enter details below.');
      }
      // 'cancelled' stays silent — the user chose to close the sheet.
      void queryClient.invalidateQueries({ queryKey: providerKeys.payoutAccount });
      void queryClient.invalidateQueries({ queryKey: providerKeys.tax });
      void queryClient.invalidateQueries({ queryKey: providerKeys.payoutReadiness });
    },
    onError: () => {
      errorTick();
      setNotice('Verification could not start. Try again, or enter details below.');
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
 *
 * MEMBERS ONLY. A provider's face is a photograph (Amit, 2026-09-17: "provider
 * dp can be never be avatar.. always real photo.. user dp will be avatar"), and
 * migration 112 raises 42501 on a provider row that is written a clay sentinel.
 * The `role` filter below is the same rule said one round trip earlier, so the
 * person gets a sentence instead of a Postgres error; the database is what
 * actually holds the line.
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
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: `clay:${seed}` })
        .eq('id', me)
        .neq('role', 'provider')
        .select('id');
      if (error) {
        throw new Error(error.message);
      }
      if (data === null || data.length === 0) {
        throw new Error('Provider avatars are photographs');
      }
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: (err: Error) => {
      errorTick();
      setNotice(
        err.message === 'Provider avatars are photographs'
          ? 'Your profile photo has to be a real photograph of you.'
          : 'Could not update your avatar. Try again.',
      );
    },
  });
}

// ---------------------------------------------------------------------------
// The gallery (migration 070). A provider publishes several photos and marks
// one as the face; `profiles.avatar_url` mirrors that one by trigger, so
// nothing here ever writes avatar_url and nothing else in the app has to learn
// about this table.
// ---------------------------------------------------------------------------

/**
 * The object key inside the public `avatars` bucket for a stored avatar URL, or
 * null for anything else — a bundled `clay:<seed>` sentinel, a foreign CDN, a
 * malformed string.
 *
 * Null rather than a throw: removing the ROW is the operation that matters, and
 * a key we cannot parse means the object is left to the orphan sweep, which is
 * the same trade `useRemoveAvatar` already makes above.
 *
 * https://supabase.com/docs/reference/javascript/storage-from-remove
 */
export function avatarObjectKey(url: string): string | null {
  const marker = '/storage/v1/object/public/avatars/';
  const at = url.indexOf(marker);
  if (at < 0) {
    return null;
  }
  const key = url.slice(at + marker.length).split('?')[0] ?? '';
  return key === '' ? null : key;
}

/**
 * The gallery, live (migration 104).
 *
 * WHERE THIS LIVES, AND WHY IT IS NOT A HOOK A SCREEN CALLS. The socket is
 * mounted by `useProviderPhotos` itself, below, rather than exported for each
 * reader to remember. Two screens read a gallery today — the member's
 * ProviderDetailScreen and the provider's own ProviderHomeScreen — and the one
 * that must not miss a change is the one whose author is not thinking about
 * sockets. A third reader gets it by construction; a `useLiveProviderPhotos`
 * they forget to call is a face that silently stops updating, which is the
 * defect this exists to remove rather than relocate.
 *
 * THREE BINDINGS, NOT ONE `event: '*'`, and the asymmetry is the whole design.
 * Migration 104's header carries the reasoning; the short version is that
 * Postgres Changes applies RLS to INSERT and UPDATE but not to DELETE ("RLS
 * policies are not applied to DELETE statements, because there is no way for
 * Postgres to verify that a user has access to a deleted record"), and a
 * `filter` on a DELETE only works when the table's replica identity is `full`
 * — which 104 deliberately does not set, because with deletes skipping RLS a
 * full old row is a broadcast of every gallery's deletions to every subscriber.
 * So INSERT and UPDATE are filtered to this provider server-side, and DELETE
 * arrives unfiltered carrying its primary key alone and is matched against the
 * gallery this client is already holding. A uuid we do not hold is not our
 * provider's, and is dropped.
 * https://supabase.com/docs/guides/realtime/postgres-changes
 *
 * WHAT IS INVALIDATED, AND THE CACHE THAT WOULD OTHERWISE SWALLOW THE EVENT.
 * A correct event landing behind a stale read is the same bug as no event, so
 * all three holders of this fact are invalidated together: the gallery itself,
 * the directory (`provider_directory` carries the mirrored scalar the 070
 * trigger writes, and it is the Hero's fallback and the rail's face), and the
 * conversation list (`conversation_summaries.peer_avatar_url` is the same
 * scalar again, in the inbox row). Their staleTimes — 60s, 30s and 10s — are
 * exactly what an event has to override, and `invalidateQueries` refetches an
 * active query regardless of them.
 *
 * THE IMAGE CACHE NEEDS NOTHING, which was checked rather than assumed. A
 * promotion does not rewrite a URL: every object is uploaded to
 * `{uid}/{Date.now()}-{index}.{ext}` and the row's `url` is frozen by 070's
 * column guard, so the new face is a DIFFERENT uri and Fresco has never seen
 * it. Appending a cache-buster would defeat both the CDN and the bitmap cache
 * for every avatar in the app to solve a problem that does not exist.
 *
 * A refresh on SUBSCRIBED as well as on failure, for the same reason
 * sessions.ts does it: the query may have been served from a cache up to its
 * staleTime old, and the socket only covers what happened after it came up. A
 * channel that fails without recovering would otherwise sit on that gap
 * forever.
 */
function useLiveProviderPhotos(providerId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (providerId === null) {
      return;
    }
    let cancelled = false;

    const refresh = (): void => {
      void queryClient.invalidateQueries({ queryKey: providerKeys.photos(providerId) });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    };

    const channel = supabase
      .channel(`provider-photos:${providerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'provider_photos',
          filter: `provider_id=eq.${providerId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'provider_photos',
          filter: `provider_id=eq.${providerId}`,
        },
        // Both halves of a swap arrive here: 070's BEFORE trigger demotes the
        // old primary and the client's own statement promotes the new one, and
        // deleting the primary arrives as the AFTER trigger promoting a
        // survivor — an UPDATE on a row that still exists, so the face changing
        // never depends on the unfiltered DELETE binding below.
        refresh,
      )
      .on<ProviderPhoto>(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'provider_photos' },
        payload => {
          // Unfiltered by necessity (a delete filter needs replica identity
          // full), so this is the filter, applied to a payload that is nothing
          // but a primary key. An id we are not holding is somebody else's
          // provider and tells us nothing we did not already know.
          const goneId = payload.old.id;
          if (goneId === undefined) {
            return;
          }
          const held = queryClient.getQueryData<ProviderPhoto[]>(
            providerKeys.photos(providerId),
          );
          if ((held ?? []).some(p => p.id === goneId)) {
            refresh();
          }
        },
      );

    void (async () => {
      // Realtime authorises `postgres_changes` against the caller's JWT, so the
      // socket has to be holding the current one before we subscribe — without
      // this a token refresh can leave the channel authenticated as the previous
      // session and silently deliver nothing, which is the note src/api/realtime.ts
      // carries from having been bitten by it. Silent delivery of nothing is
      // indistinguishable from a provider who has not changed their photo.
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (data.session?.access_token !== undefined) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      // Re-checked after the await as well: a fast swipe between two providers
      // during it would otherwise subscribe (and orphan) this channel, because
      // the cleanup below already ran before `subscribe` was ever called. Same
      // trap, same fix, as realtime.ts.
      if (cancelled) {
        return;
      }
      channel.subscribe(status => {
        if (
          status === 'SUBSCRIBED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          refresh();
        }
      });
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [providerId, queryClient]);
}

/**
 * A provider's published photos, primary first and then oldest.
 *
 * That order is the same order the detail hero pages in, so page 1 is always
 * the face and always matches the avatar the member has already seen in the
 * directory, the rail and the push notification.
 *
 * Live since 104: the socket is part of the query rather than a second thing a
 * screen has to remember — see `useLiveProviderPhotos` above.
 */
export function useProviderPhotos(providerId: string | null) {
  useLiveProviderPhotos(providerId);
  return useQuery<ProviderPhoto[]>({
    queryKey: providerKeys.photos(providerId ?? ''),
    enabled: providerId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_photos')
        .select('id, provider_id, url, is_primary, created_at')
        .eq('provider_id', providerId as string)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) {
        throw new Error(error.message);
      }
      return data ?? [];
    },
  });
}

/**
 * Throw away storage objects a failed batch has already uploaded.
 *
 * `useAddProviderPhotos` uploads every object BEFORE the row insert, because
 * the row's `url` is not known until the object exists. If the insert is then
 * refused — the P0010 ceiling, or the missing-relation error before 070 is
 * applied — the objects are unreachable by any row and would sit in the bucket
 * until the orphan sweep. This deletes exactly the keys THIS call created, so a
 * pre-existing photo can never be caught by it, and one `remove` call rather
 * than one per key because that is the API's shape (and its 1000-key limit is
 * two orders of magnitude above `MAX_PROVIDER_PHOTOS`).
 * https://supabase.com/docs/guides/storage/management/delete-objects
 *
 * Failure-tolerant by construction: `remove` reports through `{ error }` rather
 * than throwing, and both that and an unexpected throw are swallowed here so
 * the caller can raise the ORIGINAL insert failure — the one the provider needs
 * to see. A cleanup that could not run leaves the same orphan we started with,
 * which is the trade `useRemoveProviderPhoto` and `useRemoveAvatar` already
 * make; it is logged in dev, like the auth-callback diagnostics.
 */
async function discardUploads(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  try {
    const { error } = await supabase.storage.from('avatars').remove(paths);
    if (error !== null && __DEV__) {
      console.warn(`provider photos: ${paths.length} uploads left orphaned: ${error.message}`);
    }
  } catch (err) {
    if (__DEV__) {
      console.warn(`provider photos: could not discard ${paths.length} uploads`, err);
    }
  }
}

/**
 * Publish one or more photos.
 *
 * Reuses 038's public `avatars` bucket and 013's `{uid}/{stamp}.{ext}` path
 * shape through the same RN-FormData POST `useUploadAvatar` uses above — a
 * second upload path would be a second set of storage policies to keep right.
 * The only difference is the destination of the URL: a row in
 * `provider_photos` rather than `profiles.avatar_url`, which the 070 trigger
 * writes from the primary row.
 *
 * The rows go in as ONE insert so the gallery either gains all of the batch or
 * none of it, and so the database's ceiling sees the true count.
 *
 * https://developer.android.com/training/data-storage/shared/photopicker
 */
export function useAddProviderPhotos() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<number, Error, { uri: string; mime?: string }[]>({
    mutationFn: async drafts => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth.user?.id;
      const session = (await supabase.auth.getSession()).data.session;
      if (me === undefined || session?.access_token === undefined) {
        throw new Error('No session');
      }

      // Two parallel lists on purpose: the row takes the public URL, the
      // cleanup below takes the object key, and deriving one from the other
      // after the fact would mean re-parsing a URL we already have the key for.
      const urls: string[] = [];
      const uploaded: string[] = [];
      for (const [index, draft] of drafts.entries()) {
        const mime = draft.mime ?? 'image/jpeg';
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        const path = `${me}/${Date.now()}-${index}.${ext}`;
        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', {
          uri:
            draft.uri.startsWith('file://') || draft.uri.startsWith('content://')
              ? draft.uri
              : `file://${draft.uri}`,
          name: `photo.${ext}`,
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
        // One bad frame out of five should not lose the other four; the ones
        // that landed are still worth publishing.
        if (response.ok) {
          urls.push(`${ENV.supabaseUrl}/storage/v1/object/public/avatars/${path}`);
          uploaded.push(path);
        }
      }

      if (urls.length === 0) {
        throw new Error('UPLOAD');
      }

      const { error } = await supabase
        .from('provider_photos')
        .insert(urls.map(url => ({ provider_id: me, url })));
      if (error) {
        // The batch was refused, so every object uploaded for it is now an
        // orphan: no row points at it and nothing in the app will ever ask for
        // it again. Awaited before the throw so the notice the provider reads
        // is not racing a delete, and swallowed inside `discardUploads` so a
        // failed cleanup cannot replace the reason the insert failed.
        await discardUploads(uploaded);
        // P0010 is the 070 ceiling. Matched on the code first, because the
        // message is the database's wording and not ours to depend on.
        throw new Error(
          error.code === 'P0010' || /at most \d+ photos/.test(error.message)
            ? 'CAP'
            : error.message,
        );
      }
      return urls.length;
    },
    onSuccess: () => {
      tick();
      setNotice('Photos added. Members will see them on your profile.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: ['provider-photos'] });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: err => {
      errorTick();
      setNotice(
        err.message === 'CAP'
          ? `You can publish up to ${MAX_PROVIDER_PHOTOS} photos.`
          : 'Could not upload those photos. Try again.',
      );
    },
  });
}

/**
 * Make one photo the face.
 *
 * ONE statement: the 070 BEFORE trigger demotes the previous primary and the
 * AFTER trigger rewrites `profiles.avatar_url`, so the client never issues a
 * second write that could race the first — and the partial unique index never
 * sees two primaries.
 */
export function useSetPrimaryPhoto() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, string>({
    mutationFn: async photoId => {
      const { error } = await supabase
        .from('provider_photos')
        .update({ is_primary: true })
        .eq('id', photoId);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: ['provider-photos'] });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: () => {
      errorTick();
      setNotice('Could not change your main photo.');
    },
  });
}

/**
 * Unpublish one photo.
 *
 * The row goes first and the storage object second, best-effort: an orphaned
 * object is the sweep's problem, whereas a row pointing at a deleted object is
 * a broken hero a member sees. If the deleted photo was the primary, the 070
 * trigger promotes the oldest survivor and moves `avatar_url` with it.
 */
export function useRemoveProviderPhoto() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, ProviderPhoto>({
    mutationFn: async photo => {
      const { error } = await supabase.from('provider_photos').delete().eq('id', photo.id);
      if (error) {
        throw new Error(error.message);
      }
      const key = avatarObjectKey(photo.url);
      if (key !== null) {
        // Swallowed on purpose: the row is gone, which is what members see, and
        // a surviving object is the orphan sweep's problem — exactly the trade
        // useRemoveAvatar already makes.
        await supabase.storage
          .from('avatars')
          .remove([key])
          .catch(() => undefined);
      }
    },
    onSuccess: () => {
      tick();
      void queryClient.invalidateQueries({ queryKey: ['provider-photos'] });
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.providers });
    },
    onError: () => {
      errorTick();
      setNotice('Could not remove that photo.');
    },
  });
}

/**
 * A member rating ONE ended session (migration 066, goal item 14).
 *
 * The post-disconnect path. Distinct from `useSubmitReview` below, which is
 * 006's lenient conversation-level entry point: this one refuses a session that
 * has not ended, and re-submitting corrects the rating rather than adding a
 * second opinion. Every rating counts toward the provider's average — a member
 * who comes back five times has five opinions (Amit, 2026-09-06).
 */
export function useSubmitSessionReview() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, { sessionId: string; rating: number; comment: string | null }>({
    mutationFn: async input => {
      const { error } = await supabase.rpc('submit_session_review', {
        p_session_id: input.sessionId,
        p_rating: input.rating,
        p_comment: input.comment,
      });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: (_void, input) => {
      tick();
      // A 1..5 integer is safe as a telemetry dimension; the free text never is.
      track('review_submitted', { rating: input.rating });
      setNotice('Thanks, that helps the next person choose.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: keys.providers });
      void queryClient.invalidateQueries({ queryKey: ['provider-ratings'] });
    },
    onError: err => {
      errorTick();
      setNotice(
        /has not ended/.test(err.message)
          ? 'You can rate this once the session ends.'
          : 'Could not save that rating.',
      );
    },
  });
}

/**
 * A provider's reputation as a member reads it (item 10): the average, the
 * count, a five-row 5..1 distribution and the recent comments.
 *
 * An RPC rather than a table read, because 006's RLS lets a member read only
 * reviews they are party to — which is right, and also means the raw table
 * cannot answer this question.
 */
export function useProviderRatings(providerId: string | null) {
  return useQuery<ProviderRatings | null>({
    queryKey: ['provider-ratings', providerId ?? ''],
    enabled: providerId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_provider_ratings', {
        p_provider_id: providerId as string,
      });
      if (error) {
        throw new Error(error.message);
      }
      return (data as ProviderRatings | null) ?? null;
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
