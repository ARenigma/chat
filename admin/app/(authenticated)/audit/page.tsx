import { createServiceClient } from '@/lib/supabase/service';
import { diffPayload } from '@/lib/audit/diff';
import {
  AUDIT_ACTIONS,
  AUDIT_RANGES,
  type AuditAction,
  type AuditDetail,
  type AuditFilters,
  type AuditRange,
  type AuditRow,
} from '@/lib/audit/types';
import { AuditView } from './AuditView';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const RANGE_MS: Record<AuditRange, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

interface VersionRef {
  id: string;
  domain: string;
  environment: string;
  version_number: number;
}

/**
 * Before/after for the rows on this page: each row's version payload against the
 * previous version of the same domain and environment. Best-effort and read-only;
 * a failure just means the sheet shows no diff.
 */
async function loadDetails(svc: ReturnType<typeof createServiceClient>, rows: AuditRow[]): Promise<Record<string, AuditDetail>> {
  const ids = [...new Set(rows.map((r) => r.version_id).filter((v): v is string => !!v))];
  if (ids.length === 0) return {};
  try {
    const admin = svc.schema('admin');
    const { data: targets, error } = await admin
      .from('config_versions')
      .select('id, domain, environment, version_number')
      .in('id', ids);
    if (error || !targets) return {};
    const refs = targets as VersionRef[];
    const domains = [...new Set(refs.map((t) => t.domain))];
    const { data: siblings } = await admin
      .from('config_versions')
      .select('id, domain, environment, version_number')
      .in('domain', domains)
      .order('version_number', { ascending: false })
      .limit(500);
    const all = (siblings ?? []) as VersionRef[];
    const prevOf = new Map<string, string | null>();
    for (const t of refs) {
      const prev = all
        .filter((s) => s.domain === t.domain && s.environment === t.environment && s.version_number < t.version_number)
        .sort((a, b) => b.version_number - a.version_number)[0];
      prevOf.set(t.id, prev?.id ?? null);
    }
    const want = [...new Set([...ids, ...[...prevOf.values()].filter((v): v is string => !!v)])];
    const { data: payloads } = await admin.from('config_versions').select('id, payload').in('id', want);
    const byId = new Map(((payloads ?? []) as { id: string; payload: unknown }[]).map((p) => [p.id, p.payload]));
    const out: Record<string, AuditDetail> = {};
    for (const r of rows) {
      const t = refs.find((x) => x.id === r.version_id);
      if (!t || !byId.has(t.id)) continue;
      const prevId = prevOf.get(t.id);
      // Predecessor outside the 500-row window: show no diff rather than a false "everything added".
      if (!prevId && t.version_number > 1) continue;
      out[r.id] = {
        version: t.version_number,
        environment: t.environment,
        changes: diffPayload(prevId ? byId.get(prevId) : null, byId.get(t.id)),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; actor?: string; action?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const pageNum = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;

  const filters: AuditFilters = {
    actor: sp.actor?.trim() || undefined,
    action: (AUDIT_ACTIONS as readonly string[]).includes(sp.action ?? '') ? (sp.action as AuditAction) : undefined,
    range: sp.range && Object.hasOwn(AUDIT_RANGES, sp.range) ? (sp.range as AuditRange) : undefined,
  };
  const now = new Date();

  const svc = createServiceClient();
  let query = svc
    .schema('admin')
    .from('config_audit')
    .select('id, action, domain, actor, reason, confirmation, created_at, version_id, metadata', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (filters.actor) query = query.eq('actor', filters.actor);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.range) query = query.gte('created_at', new Date(now.getTime() - RANGE_MS[filters.range]).toISOString());

  const [{ data, count, error }, { data: actorRows }] = await Promise.all([
    query.range(offset, offset + PAGE_SIZE - 1),
    // Bounded: the most recent 500 entries are enough to list the people who act here.
    svc.schema('admin').from('config_audit').select('actor').order('created_at', { ascending: false }).limit(500),
  ]);

  const rows = (data ?? []) as AuditRow[];
  const actors = [...new Set(((actorRows ?? []) as { actor: string }[]).map((r) => r.actor))].sort();
  const details = await loadDetails(svc, rows);

  return (
    <AuditView
      rows={rows}
      total={count ?? 0}
      page={pageNum}
      pageSize={PAGE_SIZE}
      filters={filters}
      actors={actors}
      details={details}
      nowIso={now.toISOString()}
      error={error?.message ?? null}
    />
  );
}
