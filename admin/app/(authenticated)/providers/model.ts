// Shared, pure types and helpers for the Providers screens. No Supabase here,
// so the list and detail Views can render with fixtures.
import type { Tone } from '@/components/ui/badge';
import type { StatusIconState } from '@/components/ui/status-icon';

export interface ProviderRow {
  id: string;
  display_name: string | null;
  provider_category: string | null;
  is_available: boolean;
  presence_online: boolean;
  identity_verified: boolean;
  suspended_until: string | null;
  delisted_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  photo_count: number;
  pending_tokens: number;
  paid_tokens: number;
  active_strikes: number;
  created_at: string;
}

export type ProviderStatusKey =
  | 'online'
  | 'available'
  | 'offline'
  | 'unverified'
  | 'suspended'
  | 'banned'
  | 'delisted';

export interface ProviderStatusMeta {
  label: string;
  state: StatusIconState;
  tone: Tone;
}

/** Group order in the list: healthy first, then what needs attention. */
export const STATUS_ORDER: ProviderStatusKey[] = [
  'online',
  'available',
  'offline',
  'unverified',
  'suspended',
  'banned',
  'delisted',
];

export const STATUS_META: Record<ProviderStatusKey, ProviderStatusMeta> = {
  online: { label: 'Online', state: 'done', tone: 'success' },
  available: { label: 'Available', state: 'progress', tone: 'success' },
  offline: { label: 'Offline', state: 'todo', tone: 'neutral' },
  unverified: { label: 'Unverified', state: 'backlog', tone: 'warning' },
  suspended: { label: 'Suspended', state: 'canceled', tone: 'warning' },
  banned: { label: 'Banned', state: 'canceled', tone: 'danger' },
  delisted: { label: 'Delisted', state: 'canceled', tone: 'neutral' },
};

interface StatusInput {
  suspended_until: string | null;
  delisted_at: string | null;
  identity_verified: boolean;
  presence_online: boolean;
  is_available: boolean;
}

/** Same precedence the console always used: ban/suspend, delist, unverified, then presence. */
export function providerStatus(p: StatusInput, now: Date): ProviderStatusKey {
  if (p.suspended_until && new Date(p.suspended_until) > now) {
    return p.suspended_until.startsWith('2999') ? 'banned' : 'suspended';
  }
  if (p.delisted_at) return 'delisted';
  if (!p.identity_verified) return 'unverified';
  if (p.presence_online) return 'online';
  if (p.is_available) return 'available';
  return 'offline';
}

// Fixed zone so the server render and the browser hydrate to the same text.
const ZONE = 'Asia/Kolkata';

export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit', timeZone: ZONE });
}

export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONE,
  });
}

/** Short mono id used in lists and the detail header. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── Detail ──────────────────────────────────────────────────────────────────

export interface ProviderProfile {
  id: string;
  display_name: string | null;
  role: string;
  provider_category: string | null;
  is_available: boolean;
  presence_online: boolean;
  identity_verified_at: string | null;
  suspended_until: string | null;
  delisted_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  languages: string[] | null;
  headline: string | null;
  about: string | null;
  date_of_birth: string | null;
  created_at: string;
}

export interface ProviderPhoto {
  id: string;
  url: string;
  is_primary: boolean;
  created_at: string;
}

export interface PayoutBatch {
  id: string;
  status: string;
  total_tokens: number;
  total_paise: number;
  initiated_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ContactStrike {
  id: string;
  created_at: string;
  expires_at: string;
  voided_at: string | null;
}

export interface ProviderDetail {
  profile: ProviderProfile;
  photos: ProviderPhoto[];
  batches: PayoutBatch[];
  strikes: ContactStrike[];
  /** Status only. The full PAN and account number are never read here. */
  panStatus: string | null;
  payoutAccountStatus: string | null;
  pendingTokens: number;
  paidTokens: number;
  /** ISO timestamp the server rendered at, so status logic is stable across hydration. */
  now: string;
}

export interface ProviderNav {
  /** 1-based position in the list, newest first. */
  position: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

export type ProviderAction = 'suspend' | 'lift' | 'ban' | 'delist' | 'relist';
