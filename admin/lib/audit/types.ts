export const AUDIT_ACTIONS = ['draft_created', 'published_staging', 'promoted_prod', 'scheduled', 'rollback', 'activation_cron'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_RANGES = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' } as const;
export type AuditRange = keyof typeof AUDIT_RANGES;

export interface AuditRow {
  id: string;
  action: string;
  domain: string | null;
  actor: string;
  reason: string;
  confirmation: string | null;
  created_at: string;
  version_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

/** Per-row detail for the sheet: the version this row touched and what changed against its predecessor. */
export interface AuditDetail {
  version: number | null;
  environment: string | null;
  changes: DiffEntry[];
}

export interface AuditFilters {
  actor?: string;
  action?: AuditAction;
  range?: AuditRange;
}
