import { createServiceClient } from '@/lib/supabase/service';
import { countByKey, dayLabel, istDayKey, lastDays, lastWeeks, weekStartKey } from './bucket';
import type { DashboardData, Section } from './types';

// Server-only, read-only. Every query is bounded (a recent window or a row cap)
// and every section fails on its own: one broken view shows an inline error
// panel for that section, never a crashed page. Callers must already have passed
// the founder gate (the (authenticated) layout does).

const ROW_CAP = 5000;
const WEEKS = 8;
const AUDIT_DAYS = 14;
const PAID_DAYS = 30;
const OPEN_APPLICATION_STATUSES = ['submitted', 'under_review', 'needs_info'];
const STAGES = ['submitted', 'under_review', 'needs_info', 'approved', 'rejected'] as const;
const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  needs_info: 'Needs info',
  approved: 'Approved',
  rejected: 'Rejected',
};

async function section<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Query failed' };
  }
}

function rows<T>(r: { data: unknown; error: { message: string } | null }): T[] {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as T[];
}

const oldest = (list: (string | null)[]): string | null =>
  list.reduce<string | null>((a, b) => (b && (!a || b < a) ? b : a), null);

export async function fetchDashboardData(now: Date = new Date()): Promise<DashboardData> {
  const svc = createServiceClient();
  const nowIso = now.toISOString();
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  const [providers, applications, payouts, contactGuard, refunds, activity, configMissing] = await Promise.all([
    section(async () => {
      const list = rows<{
        presence_online: boolean;
        identity_verified: boolean;
        suspended_until: string | null;
        delisted_at: string | null;
      }>(
        await svc
          .schema('admin')
          .from('providers_list')
          .select('presence_online, identity_verified, suspended_until, delisted_at')
          .limit(ROW_CAP)
      );
      const counts = { Online: 0, Offline: 0, Unverified: 0, Suspended: 0, Delisted: 0 };
      for (const p of list) {
        if (p.delisted_at) counts.Delisted += 1;
        else if (p.suspended_until && p.suspended_until > nowIso) counts.Suspended += 1;
        else if (!p.identity_verified) counts.Unverified += 1;
        else if (p.presence_online) counts.Online += 1;
        else counts.Offline += 1;
      }
      return {
        total: list.length,
        online: counts.Online,
        buckets: Object.entries(counts)
          .filter(([, value]) => value > 0)
          .map(([name, value]) => ({ name, value })),
      };
    }),

    section(async () => {
      const list = rows<{ status: string; submitted_at: string | null }>(
        await svc
          .from('provider_applications')
          .select('status, submitted_at')
          .neq('status', 'draft')
          .order('submitted_at', { ascending: false, nullsFirst: false })
          .limit(ROW_CAP)
      );
      const weekKeys = lastWeeks(WEEKS, now);
      const open = list.filter((a) => OPEN_APPLICATION_STATUSES.includes(a.status));
      return {
        open: open.length,
        oldestOpenAt: oldest(open.map((a) => a.submitted_at)),
        weeks: weekKeys.map(dayLabel),
        stages: STAGES.map((s) => ({
          name: STAGE_LABEL[s],
          data: countByKey(
            list.filter((a) => a.status === s),
            weekKeys,
            (a) => (a.submitted_at ? weekStartKey(a.submitted_at) : null)
          ),
        })),
      };
    }),

    section(async () => {
      const [queue, history] = await Promise.all([
        svc.schema('admin').from('payable_providers').select('claimable_tokens, payable').limit(ROW_CAP),
        svc
          .schema('admin')
          .from('payout_history')
          .select('total_paise, completed_at')
          .eq('status', 'completed')
          .gte('completed_at', since(PAID_DAYS))
          .limit(ROW_CAP),
      ]);
      const q = rows<{ claimable_tokens: number; payable: boolean }>(queue);
      const h = rows<{ total_paise: number; completed_at: string | null }>(history);
      const days = lastDays(PAID_DAYS, now);
      const idx = new Map(days.map((k, i) => [k, i]));
      const trend = days.map(() => 0);
      for (const b of h) {
        const i = b.completed_at ? idx.get(istDayKey(b.completed_at)) : undefined;
        if (i !== undefined) trend[i] = (trend[i] ?? 0) + b.total_paise / 100;
      }
      return {
        claimableTokens: q.reduce((s, r) => s + Number(r.claimable_tokens), 0),
        claimableProviders: q.length,
        payableProviders: q.filter((r) => r.payable).length,
        paidPaise: h.reduce((s, r) => s + Number(r.total_paise), 0),
        paidDays: days.map(dayLabel),
        paidTrend: trend,
      };
    }),

    section(async () => {
      const list = rows<{ review_requested_at: string | null }>(
        await svc.from('contact_guard_review_queue').select('review_requested_at').limit(ROW_CAP)
      );
      return { count: list.length, oldestAt: oldest(list.map((r) => r.review_requested_at)) };
    }),

    section(async () => {
      const list = rows<{ created_at: string }>(
        await svc.from('refund_reviews').select('created_at').eq('status', 'pending').limit(ROW_CAP)
      );
      return { count: list.length, oldestAt: oldest(list.map((r) => r.created_at)) };
    }),

    section(async () => {
      const [config, admin] = await Promise.all([
        svc.schema('admin').from('config_audit').select('created_at').gte('created_at', since(AUDIT_DAYS)).limit(ROW_CAP),
        svc.schema('admin').from('audit_log').select('created_at').gte('created_at', since(AUDIT_DAYS)).limit(ROW_CAP),
      ]);
      // One failing source degrades to the other; both failing is a section error.
      if (config.error && admin.error) throw new Error(config.error.message);
      const keys = lastDays(AUDIT_DAYS, now);
      const bucket = (r: { data: unknown; error: unknown }) =>
        countByKey(((r.error ? [] : r.data) ?? []) as { created_at: string }[], keys, (x) => istDayKey(x.created_at));
      const series = [
        { name: 'Config changes', data: bucket(config) },
        { name: 'Admin actions', data: bucket(admin) },
      ];
      return {
        days: keys.map(dayLabel),
        series,
        total: series.reduce((s, x) => s + x.data.reduce((a, b) => a + b, 0), 0),
      };
    }),

    section(async () => {
      const [domains, active] = await Promise.all([
        svc.schema('admin').from('config_domains').select('key'),
        svc.schema('admin').from('config_active').select('domain').eq('environment', 'prod'),
      ]);
      return Math.max(0, rows(domains).length - rows(active).length);
    }),
  ]);

  return { generatedAt: nowIso, providers, applications, payouts, contactGuard, refunds, activity, configMissing };
}
