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

// ─── Domain payload types ────────────────────────────────────────────────────

export interface EconomicsConfig {
  chat_rate_tokens_per_min: number;
  audio_rate_tokens_per_min: number;
  video_rate_tokens_per_min: number;
  provider_share_percent: number; // bps
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

export interface PayoutsConfig {
  cadence: 'weekly';
  hold_days: number;
  minimum_paise: number;
  cashfree_payouts_enabled: boolean;
}

export interface KillSwitchesConfig {
  payments_enabled: boolean;
  calls_enabled: boolean;
  new_registrations_enabled: boolean;
  mock_payments_allowed: boolean;
}

export interface ReportTaxonomyConfig {
  reasons: string[];
}

export interface AuthUiConfig {
  phone_auth_tab_visible: boolean;
  google_auth_tab_visible: boolean;
}

// ─── Compile-time fallbacks ──────────────────────────────────────────────────
// These values are used when the config RPC is unavailable (offline, error,
// or no version published yet). They must match the seeds in migration 026.

export const FALLBACK_ECONOMICS: EconomicsConfig = {
  chat_rate_tokens_per_min: 22,
  audio_rate_tokens_per_min: 22,
  video_rate_tokens_per_min: 35,
  provider_share_percent: 6000, // 60% in bps
  gst_rate_bps: 1800,
};

export const FALLBACK_RECHARGE: RechargeConfig = {
  packs_inr: [100, 300, 500, 1000, 2500, 5000],
  play_product_ids: [],
  cashfree_enabled: false,
  play_ucb_enabled: false,
};

export const FALLBACK_WALLET: WalletConfig = {
  starting_grant_tokens: 0,
  daily_refill_enabled: false,
  daily_refill_tokens: 25,
};

export const FALLBACK_THRESHOLDS: ThresholdsConfig = {
  low_balance_tokens: 22,
  rate_limit_messages_per_min: 20,
  unanswered_refund_window_hours: 24,
};

export const FALLBACK_KILL_SWITCHES: KillSwitchesConfig = {
  // Safe-fail: no real payments until explicitly enabled via admin.
  payments_enabled: false,
  calls_enabled: true,
  new_registrations_enabled: true,
  mock_payments_allowed: true,
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

export const FALLBACK_AUTH_UI: AuthUiConfig = {
  phone_auth_tab_visible: true,
  google_auth_tab_visible: true,
};

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

/** Wallet credits (starting grant, daily refill). */
export function useWalletConfig() {
  return useQuery({
    queryKey: ['config', 'wallet'],
    queryFn: () => fetchAuthConfig<WalletConfig>('wallet', FALLBACK_WALLET),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_WALLET,
  });
}

/** Operational limits (low balance, rate limits, refund window). */
export function useThresholdsConfig() {
  return useQuery({
    queryKey: ['config', 'thresholds'],
    queryFn: () => fetchAuthConfig<ThresholdsConfig>('thresholds', FALLBACK_THRESHOLDS),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_THRESHOLDS,
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

/** Auth UI visibility — safe to read pre-auth. */
export function useAuthUiConfig() {
  return useQuery({
    queryKey: ['config', 'auth_ui'],
    queryFn: () => fetchPublicConfig<AuthUiConfig>('auth_ui', FALLBACK_AUTH_UI),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    placeholderData: FALLBACK_AUTH_UI,
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
