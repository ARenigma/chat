'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, SlidersHorizontal } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { StatusBadge, type Tone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ConfigIndexDomain, ConfigRisk } from '@/lib/config-view';
import { cn } from '@/lib/utils';

const RISK_TONE: Record<ConfigRisk, Tone> = { high: 'danger', medium: 'warning', low: 'neutral' };
const RISK_LABEL: Record<ConfigRisk, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };

function RiskChip({ risk }: { risk: ConfigRisk | null }) {
  // Low risk is the default state, so it is not worth a chip in a dense list.
  if (!risk || risk === 'low') return null;
  return (
    <StatusBadge status={risk} tone={RISK_TONE[risk]} className="h-4 px-1.5 text-2xs">
      {RISK_LABEL[risk]}
    </StatusBadge>
  );
}

function VersionLabel({ d }: { d: ConfigIndexDomain }) {
  return d.versionNumber != null ? (
    <span className="font-mono text-xs text-tertiary">v{d.versionNumber}</span>
  ) : (
    <span className="text-xs text-warning">No active</span>
  );
}

/** Linear Settings layout: domain list on the left, the selected domain's live values on the right. */
export function ConfigIndexView({ domains }: { domains: ConfigIndexDomain[] }) {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(domains[0]?.key ?? null);
  const selected = domains.find((d) => d.key === selectedKey) ?? domains[0];

  if (domains.length === 0 || !selected) {
    return <EmptyState cause="cold-start" title="No config domains" body="Run migrations to seed domains." />;
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <nav aria-label="Config domains" className="overflow-hidden rounded-lg border border-hairline bg-raised">
        <ul className="divide-y divide-hairline">
          {domains.map((d) => {
            const isSelected = d.key === selected.key;
            return (
              <li key={d.key}>
                <button
                  type="button"
                  aria-current={isSelected || undefined}
                  onClick={() => setSelectedKey(d.key)}
                  data-testid={`config-domain-${d.key}`}
                  className={cn(
                    'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-100 hover:bg-hover focus-visible:relative focus-visible:z-[1]',
                    isSelected && 'bg-selected'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-hairline-strong bg-surface text-secondary"
                  >
                    <SlidersHorizontal size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-primary">{d.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-secondary">{d.description}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <VersionLabel d={d} />
                    <RiskChip risk={d.risk} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section
        aria-label={`${selected.name} summary`}
        className="overflow-hidden rounded-lg border border-hairline bg-raised"
      >
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-4">
          <div className="min-w-0">
            <h2 className="text-md font-semibold tracking-[-0.01em] text-primary">{selected.name}</h2>
            <p className="mt-1 text-sm text-secondary">{selected.description}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {selected.versionNumber != null ? (
                <>
                  <StatusBadge status="active" />
                  <span className="text-xs text-secondary">
                    <span className="font-mono">v{selected.versionNumber}</span>
                    {selected.publishedLabel && <> · published {selected.publishedLabel}</>}
                  </span>
                </>
              ) : (
                <StatusBadge status="draft" tone="warning">No active config</StatusBadge>
              )}
              <StatusBadge status={selected.runtime} className="h-4 px-1.5 text-2xs" />
              <RiskChip risk={selected.risk} />
              {selected.highRiskCount > 0 && (
                <span className="text-xs text-tertiary">{selected.highRiskCount} high-impact fields</span>
              )}
            </div>
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href={`/config/${selected.key}`}>
              Edit <ArrowRight />
            </Link>
          </Button>
        </div>

        {selected.fields.length === 0 ? (
          <p className="px-4 py-6 text-sm text-secondary">
            This domain has no guided fields. Open it to edit the raw JSON payload.
          </p>
        ) : (
          <dl className="divide-y divide-hairline">
            {selected.fields.map((f) => (
              <div key={f.key} className="flex min-h-10 items-center gap-3 px-4 py-2">
                <dt className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-body">
                  {f.label}
                  {f.runtime !== 'live' && <StatusBadge status={f.runtime} className="h-4 px-1.5 text-2xs" />}
                </dt>
                <dd className="shrink-0 text-right text-sm tabular-nums text-primary">
                  {selected.versionNumber != null ? f.value : <span className="text-tertiary">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
