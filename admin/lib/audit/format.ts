import type { AuditAction } from './types';

const TZ = 'Asia/Kolkata';

/** "amit.ranjan@x.com" -> "Amit". System actors (cron, migration_036) stay readable. */
export function actorName(actor: string): string {
  const local = actor.split('@')[0] ?? actor;
  const first = local.split(/[._-]/)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const PHRASE: Record<AuditAction, (domain: string) => string> = {
  draft_created: (d) => `created a draft of ${d}`,
  published_staging: (d) => `published ${d} to staging`,
  promoted_prod: (d) => `promoted ${d} to production`,
  scheduled: (d) => `scheduled a change to ${d}`,
  rollback: (d) => `rolled back ${d}`,
  activation_cron: (d) => `activated ${d} on schedule`,
};

/** Linear activity phrasing: the verb phrase that follows the actor. */
export function describe(action: string, domain: string | null): string {
  const d = domain ?? 'config';
  const fn = (PHRASE as Record<string, ((d: string) => string) | undefined>)[action];
  return fn ? fn(d) : `${action.replace(/_/g, ' ')} ${d}`;
}

/** "2m ago", "5h ago", "3d ago", then a short date. Measured against `nowIso` so renders are deterministic. */
export function timeAgo(iso: string, nowIso: string): string {
  const mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 1440 * 7) return `${Math.floor(mins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
}

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

/** Group heading for a day: Today, Yesterday, then "Mon, 3 Nov". */
export function dayTitle(iso: string, nowIso: string): string {
  const k = dayKey(iso);
  if (k === dayKey(nowIso)) return 'Today';
  if (k === dayKey(new Date(Date.parse(nowIso) - 86_400_000).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
}

export { dayKey };

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
