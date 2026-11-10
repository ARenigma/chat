import { AuditView } from '@/app/(authenticated)/audit/AuditView';
import { AUDIT_ACTIONS, AUDIT_RANGES, type AuditAction, type AuditFilters, type AuditRange } from '@/lib/audit/types';
import { AUDIT_ACTORS, AUDIT_DETAILS, AUDIT_NOW, AUDIT_ROWS } from './fixtures';

const PAGE_SIZE = 25;
const RANGE_MS: Record<AuditRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/**
 * /design/screens/audit?state=populated|empty|loading|error[&page=&actor=&action=&range=]
 * Applies the same filters the real page applies in SQL, so the chips work in the preview.
 */
export default async function AuditPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; page?: string; actor?: string; action?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const filters: AuditFilters = {
    actor: sp.actor || undefined,
    action: (AUDIT_ACTIONS as readonly string[]).includes(sp.action ?? '') ? (sp.action as AuditAction) : undefined,
    range: sp.range && sp.range in AUDIT_RANGES ? (sp.range as AuditRange) : undefined,
  };
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const cutoff = filters.range ? Date.parse(AUDIT_NOW) - RANGE_MS[filters.range] : 0;
  const all =
    sp.state === 'empty' || sp.state === 'error'
      ? []
      : AUDIT_ROWS.filter(
          (r) =>
            (!filters.actor || r.actor === filters.actor) &&
            (!filters.action || r.action === filters.action) &&
            Date.parse(r.created_at) >= cutoff
        );
  return (
    <AuditView
      rows={all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
      total={all.length}
      page={page}
      pageSize={PAGE_SIZE}
      filters={filters}
      actors={AUDIT_ACTORS}
      details={AUDIT_DETAILS}
      nowIso={AUDIT_NOW}
      error={sp.state === 'error' ? 'canceling statement due to statement timeout' : null}
      loading={sp.state === 'loading'}
      basePath="/design/screens/audit"
    />
  );
}
