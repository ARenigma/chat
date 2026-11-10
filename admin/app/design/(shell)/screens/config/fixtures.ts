// Fixture data for the Config previews. Uses the real registry (read-only) so labels, units and
// validation are exactly what production renders; only the payloads and versions are made up.
import { CONFIG_REGISTRY } from '@/lib/config-registry';
import { toIndexDomain, formatConfigDateTime, type ConfigIndexDomain } from '@/lib/config-view';
import type { VersionHistoryItem } from '@/components/config/VersionHistory';

export const PAYLOADS: Record<string, Record<string, unknown>> = {
  economics: {
    chat_rate_tokens_per_min: 22,
    audio_rate_tokens_per_min: 22,
    video_rate_tokens_per_min: 35,
    provider_share_percent: 60,
    gst_rate_bps: 1800,
  },
  recharge: {
    packs_inr: [100, 300, 500, 1000, 2500, 5000],
    play_product_ids: ['pappal_tokens_100', 'pappal_tokens_300', 'pappal_tokens_500'],
    cashfree_enabled: true,
    play_ucb_enabled: false,
  },
  payouts: {
    cadence: 'weekly',
    hold_days: 7,
    minimum_paise: 50000,
    cashfree_payouts_enabled: false,
  },
};

const ACTIVE: Record<string, { v: number; at: string }> = {
  economics: { v: 12, at: '2026-11-02T09:40:00Z' },
  recharge: { v: 6, at: '2026-10-21T14:05:00Z' },
  payouts: { v: 3, at: '2026-10-30T11:20:00Z' },
};

export function indexFixture(): ConfigIndexDomain[] {
  return CONFIG_REGISTRY.map((def) =>
    toIndexDomain({
      key: def.key,
      description: def.description,
      def,
      versionNumber: ACTIVE[def.key]?.v ?? null,
      publishedAt: ACTIVE[def.key]?.at ?? null,
      payload: PAYLOADS[def.key] ?? null,
    })
  );
}

/** Long text and a domain missing from the registry. */
export function indexFixtureEdge(): ConfigIndexDomain[] {
  const base = indexFixture();
  const first = base[0];
  if (first) {
    base[0] = {
      ...first,
      description:
        'Per-minute rates charged to members, provider revenue share, GST handling and a very long description that must truncate on one line in the list.',
    };
  }
  base.push({
    key: 'experimental_flags_for_the_growth_team',
    name: 'experimental_flags_for_the_growth_team',
    description: 'Not in the registry: raw JSON only.',
    versionNumber: null,
    publishedLabel: null,
    runtime: 'live',
    risk: null,
    highRiskCount: 0,
    fields: [],
  });
  return base;
}

export const HISTORY: VersionHistoryItem[] = [
  { id: 'h12', versionNumber: 12, status: 'active', reason: 'Raise video rate for the Diwali week pricing review', whenLabel: formatConfigDateTime('2026-11-02T09:40:00Z') },
  { id: 'h13', versionNumber: 13, status: 'scheduled', reason: 'Revert video rate after the festival window closes on 9 November', whenLabel: formatConfigDateTime('2026-11-09T00:00:00Z') },
  { id: 'h11', versionNumber: 11, status: 'superseded', reason: 'Provider share 55% to 60%', whenLabel: formatConfigDateTime('2026-10-14T16:10:00Z') },
  { id: 'h10', versionNumber: 10, status: 'superseded', reason: null, whenLabel: formatConfigDateTime('2026-09-29T08:00:00Z') },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `hx${i}`,
    versionNumber: 9 - i,
    status: 'superseded',
    reason: i % 2 ? 'Seed from migration' : 'GST rate update per finance',
    whenLabel: formatConfigDateTime(`2026-0${8 - Math.floor(i / 2)}-1${i}T10:00:00Z`),
  })),
];
