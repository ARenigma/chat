/**
 * App configuration — live admin config with offline fallbacks.
 *
 * Every runtime knob now flows through this module. Compile-time constants
 * in src/config.ts and src/lib/rates.ts are retained as offline/error
 * fallbacks only; this module is the live source of truth.
 *
 * Architecture:
 *   1. At app boot, eagerly fetch all domains (parallel) and cache in MMKV.
 *   2. Stale-while-revalidate: return MMKV cache immediately, refresh in bg.
 *   3. On error (offline, no config published), fall back to compile-time defaults.
 *   4. Hooks re-render consumers when fresh config arrives.
 *
 * Domain→type mapping mirrors admin/lib/config-registry.ts (kept in sync manually;
 * a shared package would be ideal but is excluded by the no-new-dep rule).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import {
  FALLBACK_CLIENT_SUPPORT,
  type ClientSupportConfig,
} from '../lib/clientSupport';
import {
  DEFAULT_CONTACT_GUARD_MODE,
  contactGuardModeFrom,
  type ContactGuardMode,
} from '../lib/contactGuard';

/*
 * The shape and the fallback live in `lib/clientSupport.ts`, not here, because
 * the decision they feed has to be unit-testable and this module imports
 * supabase. Re-exported so consumers still have one config import.
 */
export { FALLBACK_CLIENT_SUPPORT };
export type { ClientSupportConfig };

// ─── Domain payload types ────────────────────────────────────────────────────

export interface EconomicsConfig {
  chat_rate_tokens_per_min: number;
  audio_rate_tokens_per_min: number;
  video_rate_tokens_per_min: number;
  /** Integer percent 0–100 (e.g. 60 = 60%). Consumers divide by 100. */
  provider_share_percent: number;
  /** Basis points (e.g. 1800 = 18%). Consumers divide by 10000 or use /100 for display. */
  gst_rate_bps: number;
}

export interface RechargeConfig {
  packs_inr: number[];
  play_product_ids: string[];
  cashfree_enabled: boolean;
  play_ucb_enabled: boolean;
}

export interface WalletConfig {
  starting_grant_tokens: number;
  daily_refill_enabled: boolean;
  daily_refill_tokens: number;
}

export interface ThresholdsConfig {
  low_balance_tokens: number;
  rate_limit_messages_per_min: number;
  unanswered_refund_window_hours: number;
}

export interface KillSwitchesConfig {
  payments_enabled: boolean;
  voice_calls_enabled: boolean;
  video_calls_enabled: boolean;
  new_registrations_enabled: boolean;
  mock_payments_allowed: boolean;
  /**
   * The contact guard (157): off | shadow | enforce. The server decides; the
   * composer predicts a block only in enforce. Optional because a payload
   * published before 157 does not carry it.
   */
  contact_guard_mode?: ContactGuardMode;
  /**
   * Stories (143): off stops adding stories, comments and reactions; viewing
   * and deleting continue. Optional: a payload published before 143 does not
   * carry it, and absent means on, as `stories_enabled()` reads it.
   */
  stories_enabled?: boolean;
}

export interface ReportTaxonomyConfig {
  reasons: string[];
}

export interface AuthUiConfig {
  phone_auth_tab_visible: boolean;
  google_auth_tab_visible: boolean;
}

export type PermissionLevel = 'optional' | 'required';

export interface PermissionsConfig {
  environment_mode: 'internal' | 'production';
  notification_internal: PermissionLevel;
  notification_production: PermissionLevel;
  microphone_internal: PermissionLevel;
  microphone_production: PermissionLevel;
  camera_internal: PermissionLevel;
  camera_production: PermissionLevel;
}

// ─── Compile-time fallbacks ──────────────────────────────────────────────────
// These values are used when the config RPC is unavailable (offline, error,
// or no version published yet). They must match the seeds in migration 026.

export const FALLBACK_ECONOMICS: EconomicsConfig = {
  chat_rate_tokens_per_min: 22,
  audio_rate_tokens_per_min: 22,
  video_rate_tokens_per_min: 35,
  provider_share_percent: 60, // integer percent; consumers do /100 to get 0.6
  gst_rate_bps: 1800,         // 18% in basis points
};

export const FALLBACK_RECHARGE: RechargeConfig = {
  packs_inr: [100, 300, 500, 1000, 2500, 5000],
  play_product_ids: [],
  // Aligned with PAYMENTS_ENABLED + migration 041 Cashfree rail.
  cashfree_enabled: true,
  play_ucb_enabled: false,
};

const FALLBACK_KILL_SWITCHES: KillSwitchesConfig = {
  // Matches PAYMENTS_ENABLED and migration 041 — first-send opens Cashfree.
  // Flip off in admin kill_switches to hard-stop collections without a redeploy.
  payments_enabled: true,
  // Independent controls: an operator may stop camera calls while voice remains
  // available. The server enforces the same pair in start_call (migration 044);
  // these client flags are immediate UI feedback, not the security boundary.
  voice_calls_enabled: true,
  video_calls_enabled: true,
  new_registrations_enabled: true,
  mock_payments_allowed: true,
  // Shadow until the owner flips it: the composer predicts nothing, the server logs.
  contact_guard_mode: DEFAULT_CONTACT_GUARD_MODE,
};

export const FALLBACK_REPORT_TAXONOMY: ReportTaxonomyConfig = {
  reasons: [
    'harassment',
    'sexual_content',
    'child_safety',
    'threats_violence',
    'hate_speech',
    'self_harm',
    'scam_spam',
    'impersonation',
    'privacy',
    'illegal_activity',
    'other',
  ],
};

export const FALLBACK_PERMISSIONS: PermissionsConfig = {
  environment_mode: 'internal',
  notification_internal: 'optional',
  notification_production: 'optional',
  microphone_internal: 'required',
  microphone_production: 'required',
  camera_internal: 'required',
  camera_production: 'required',
};

/** Resolve which permission policy applies for this build + config. */
export function effectivePermissionLevel(
  config: PermissionsConfig,
  kind: 'notification' | 'microphone' | 'camera',
): PermissionLevel {
  const treatAsProduction =
    ENV.appEnv === 'production' || config.environment_mode === 'production';
  if (kind === 'notification') {
    return treatAsProduction
      ? config.notification_production
      : config.notification_internal;
  }
  if (kind === 'microphone') {
    return treatAsProduction
      ? config.microphone_production
      : config.microphone_internal;
  }
  return treatAsProduction ? config.camera_production : config.camera_internal;
}

// ─── Fetcher helpers ─────────────────────────────────────────────────────────

/**
 * Fetch an authenticated-only config domain.
 * Caller must be signed in; uses get_active_config().
 */
async function fetchAuthConfig<T>(domain: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.rpc('get_active_config', { p_domain: domain });
  if (error || data == null) return fallback;
  return { ...fallback, ...(data as Partial<T>) };
}

/**
 * Fetch a public config domain (pre-auth safe).
 * Uses get_public_config() which allows anon role.
 */
async function fetchPublicConfig<T>(domain: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.rpc('get_public_config', { p_domain: domain });
  if (error || data == null) return fallback;
  return { ...fallback, ...(data as Partial<T>) };
}

// ─── TanStack Query hooks ─────────────────────────────────────────────────────

const STALE_TIME = 5 * 60 * 1000; // 5 minutes
const GC_TIME = 30 * 60 * 1000;   // 30 minutes

/** Per-minute rates and provider share. */
export function useEconomicsConfig() {
  return useQuery({
    queryKey: ['config', 'economics'],
    queryFn: () => fetchAuthConfig<EconomicsConfig>('economics', FALLBACK_ECONOMICS),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_ECONOMICS,
  });
}

/** Recharge pack amounts and payment rail toggles. */
export function useRechargeConfig() {
  return useQuery({
    queryKey: ['config', 'recharge'],
    queryFn: () => fetchAuthConfig<RechargeConfig>('recharge', FALLBACK_RECHARGE),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_RECHARGE,
  });
}

/**
 * The minimum client this server will talk to.
 *
 * PUBLIC, so it resolves before sign-in: an unsupported build must be told so
 * on the first screen rather than after it has authenticated into a tree whose
 * RPC contract it cannot satisfy.
 *
 * A short stale time and no `placeholderData`. The other domains hand out the
 * compile-time fallback immediately because a slightly stale rate is harmless;
 * here the fallback means "no floor", and serving it as placeholder data would
 * flash the app open for a moment before the real answer arrived. The gate
 * treats `undefined` as "still asking" and waits.
 */
export function useClientSupport() {
  return useQuery({
    queryKey: ['config', 'client_support'],
    queryFn: () =>
      fetchPublicConfig<ClientSupportConfig>('client_support', FALLBACK_CLIENT_SUPPORT),
    staleTime: 60 * 1000,
    gcTime: GC_TIME,
  });
}

/** Kill switches — safe to read pre-auth via public RPC. */
export function useKillSwitches() {
  return useQuery({
    queryKey: ['config', 'kill_switches'],
    queryFn: () => fetchPublicConfig<KillSwitchesConfig>('kill_switches', FALLBACK_KILL_SWITCHES),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_KILL_SWITCHES,
  });
}

/** The contact guard's mode, shadow whenever the payload is missing or unreadable. */
export function useContactGuardMode(): ContactGuardMode {
  const { data } = useKillSwitches();
  return contactGuardModeFrom(data?.contact_guard_mode);
}

/** Report taxonomy — auth required (user must be signed in to report). */
export function useReportTaxonomy() {
  return useQuery({
    queryKey: ['config', 'report_taxonomy'],
    queryFn: () => fetchAuthConfig<ReportTaxonomyConfig>('report_taxonomy', FALLBACK_REPORT_TAXONOMY),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_REPORT_TAXONOMY,
  });
}


// ─── Human-readable labels for report reasons ────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  harassment: 'Harassment or abuse',
  sexual_content: 'Unwanted sexual content',
  child_safety: 'Child safety concern',
  minor_safety: 'They may be under 18',
  threats_violence: 'Threats or violence',
  hate_speech: 'Hate speech',
  self_harm: 'I am worried about their safety',
  scam_spam: 'Spam or scam',
  solicitation: 'Asking to move off the app, or for money',
  impersonation: 'Pretending to be someone else',
  privacy: 'Privacy violation',
  illegal_activity: 'Illegal activity',
  spam: 'Spam or scam',
  other: 'Something else',
};

export function getReasonLabel(slug: string): string {
  return REASON_LABELS[slug] ?? slug;
}
