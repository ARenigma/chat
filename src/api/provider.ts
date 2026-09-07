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
  ProviderPhoto,
  ProviderRatings,
} from '../lib/database.types';
import { MAX_PROVIDER_PHOTOS } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
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
        /18 or older/.test(err.message)
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
        throw new Error(error.message);
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
      setNotice('Could not change what you offer.');
    },
  });
}

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
 * A provider's published photos, primary first and then oldest.
 *
 * That order is the same order the detail hero pages in, so page 1 is always
 * the face and always matches the avatar the member has already seen in the
 * directory, the rail and the push notification.
 */
export function useProviderPhotos(providerId: string | null) {
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
