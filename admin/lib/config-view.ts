import { type DomainDef, type RuntimeStatus, formatDisplayValue } from '@/lib/config-registry';

/** One changed field between the live version and the draft, already formatted for display. */
export interface ConfigDiffRow {
  key: string;
  label: string;
  oldText: string;
  newText: string;
}

export function buildConfigDiff(
  active: Record<string, unknown>,
  draft: Record<string, unknown>,
  domainDef: DomainDef | undefined
): ConfigDiffRow[] {
  if (!domainDef) return [];
  const rows: ConfigDiffRow[] = [];
  for (const field of domainDef.fields) {
    const oldVal = active[field.key];
    const newVal = draft[field.key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      rows.push({
        key: field.key,
        label: field.label,
        oldText: oldVal === undefined ? '—' : formatDisplayValue(field, oldVal),
        newText: newVal === undefined ? '—' : formatDisplayValue(field, newVal),
      });
    }
  }
  return rows;
}

export type ConfigRisk = 'high' | 'medium' | 'low';

export interface ConfigIndexField {
  key: string;
  label: string;
  value: string;
  runtime: RuntimeStatus;
  risk?: ConfigRisk;
}

/** Everything the Config index View needs for one domain: plain strings, no Supabase types. */
export interface ConfigIndexDomain {
  key: string;
  name: string;
  description: string;
  versionNumber: number | null;
  publishedLabel: string | null;
  runtime: RuntimeStatus;
  risk: ConfigRisk | null;
  highRiskCount: number;
  fields: ConfigIndexField[];
}

const RISK_ORDER: ConfigRisk[] = ['high', 'medium', 'low'];

export function formatConfigDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function formatConfigDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Build the index row from a registry definition (if any), the DB description and the active payload. */
export function toIndexDomain(args: {
  key: string;
  description: string;
  def: DomainDef | undefined;
  versionNumber: number | null;
  publishedAt: string | null;
  payload: Record<string, unknown> | null;
}): ConfigIndexDomain {
  const { key, description, def, versionNumber, publishedAt, payload } = args;
  const fields: ConfigIndexField[] = (def?.fields ?? []).map((f) => {
    const v = payload?.[f.key];
    return {
      key: f.key,
      label: f.label,
      value: v === undefined || v === null ? '—' : formatDisplayValue(f, v),
      runtime: f.runtime,
      risk: f.risk,
    };
  });
  const runtimes = fields.map((f) => f.runtime);
  const runtime: RuntimeStatus = runtimes.includes('seeded') ? 'seeded' : runtimes.includes('partial') ? 'partial' : 'live';
  const risk = RISK_ORDER.find((r) => fields.some((f) => f.risk === r)) ?? null;
  return {
    key,
    name: def?.name ?? key,
    description: description || def?.description || '',
    versionNumber,
    publishedLabel: publishedAt ? formatConfigDate(publishedAt) : null,
    runtime,
    risk,
    highRiskCount: fields.filter((f) => f.risk === 'high').length,
    fields,
  };
}
