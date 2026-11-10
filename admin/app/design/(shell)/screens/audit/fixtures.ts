import type { AuditDetail, AuditRow } from '@/lib/audit/types';

export const AUDIT_NOW = '2026-11-10T09:30:00.000Z';
const at = (mins: number) => new Date(Date.parse(AUDIT_NOW) - mins * 60_000).toISOString();

const ACTORS = ['amit.ranjan@pappal.dev', 'sneha.kulkarni@pappal.dev', 'rohan.k@pappal.dev'];
const DOMAINS = ['economics', 'recharge', 'wallet', 'thresholds', 'payouts', 'kill_switches'];
const ACTIONS = ['draft_created', 'published_staging', 'promoted_prod', 'promoted_prod', 'scheduled', 'rollback'];
const REASONS = [
  'Raise the per-minute rate for astrologers after the Diwali demand spike',
  'Hold new providers for 7 days before their first payout',
  'Draft for review',
  'Fix the pack ladder typo',
  'Turn off chat nudges while we investigate',
  'Revert: the last promotion doubled the minimum payout',
];

/** 70 rows over ~12 days, newest first, so day grouping and pagination both have something to chew on. */
export const AUDIT_ROWS: AuditRow[] = Array.from({ length: 70 }, (_, i) => {
  const minutes = i === 0 ? 2 : i * (i < 6 ? 140 : 310) + (i % 5) * 7;
  const action = i % 17 === 5 ? 'activation_cron' : (ACTIONS[i % ACTIONS.length] as string);
  return {
    id: `audit-${String(i + 1).padStart(3, '0')}`,
    action,
    domain: DOMAINS[i % DOMAINS.length] as string,
    actor: action === 'activation_cron' ? 'cron' : (ACTORS[i % ACTORS.length] as string),
    reason: action === 'activation_cron' ? '' : (REASONS[i % REASONS.length] as string),
    confirmation: action === 'promoted_prod' ? 'PROMOTE TO PRODUCTION' : null,
    created_at: at(minutes),
    version_id: `ver-${i + 1}`,
    metadata: i === 8 ? { previous_version_id: 'ver-7', previous_value: 6000, corrected_value: 60 } : null,
  };
});

export const AUDIT_ACTORS = [...new Set(AUDIT_ROWS.map((r) => r.actor))].sort();

const DIFFS: AuditDetail['changes'][] = [
  [
    { path: 'providers.astrologer.rate_per_min', kind: 'changed', before: '18', after: '22' },
    { path: 'providers.share_percent', kind: 'changed', before: '60', after: '62' },
    { path: 'providers.listener.rate_per_min', kind: 'added', after: '9' },
  ],
  [{ path: 'hold_days', kind: 'changed', before: '3', after: '7' }, { path: 'legacy_flag', kind: 'removed', before: 'true' }],
  [],
];

export const AUDIT_DETAILS: Record<string, AuditDetail> = Object.fromEntries(
  AUDIT_ROWS.map((r, i) => [
    r.id,
    { version: 40 - Math.floor(i / 2), environment: r.action === 'published_staging' ? 'staging' : 'prod', changes: DIFFS[i % DIFFS.length] ?? [] },
  ])
);
