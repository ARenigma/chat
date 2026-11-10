'use client';

import * as React from 'react';
import Link from 'next/link';
import { WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Chart } from '@/components/ui/chart';
import { Panel } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { List, ListRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { StatusIcon, type StatusIconState } from '@/components/ui/status-icon';
import type { Tone } from '@/components/ui/badge';
import { barChartOption, donutChartOption, lineChartOption } from '@/lib/chart/options';
import type { ChartTokens } from '@/lib/chart/theme';
import type { DashboardData, Section } from '@/lib/dashboard/types';

/** "3d", "5h", "12m": how long ago, measured against the time the data was read. */
function age(iso: string | null, nowIso: string): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

const rupees = (paise: number) => Math.round(paise / 100);

function SectionError({ message, height }: { message: string; height: number }) {
  return (
    <div style={{ minHeight: height }} className="flex items-center justify-center">
      <EmptyState
        cause="load-failure"
        inline
        title="Could not load this section"
        body={message}
        icon={<WarningCircle size={18} className="text-danger" aria-hidden="true" />}
      />
    </div>
  );
}

/** Renders `ok` data, an inline error panel, or a skeleton while `loading`. */
function Body<T>({
  s,
  loading,
  height,
  children,
}: {
  s: Section<T>;
  loading?: boolean;
  height: number;
  children: (data: T) => React.ReactNode;
}) {
  if (loading) return <Skeleton style={{ height }} className="w-full" />;
  if (!s.ok) return <SectionError message={s.error} height={height} />;
  return <>{children(s.data)}</>;
}

function Attention({
  href,
  state,
  tone,
  label,
  count,
  oldest,
}: {
  href: string;
  state: StatusIconState;
  tone: Tone;
  label: string;
  count: number | null;
  oldest: string;
}) {
  return (
    <ListRow href={href}>
      <StatusIcon state={state} tone={tone} />
      <span className="min-w-0 flex-1 truncate text-primary">{label}</span>
      {count === null ? (
        <span className="text-xs text-tertiary">Unavailable</span>
      ) : count === 0 ? (
        <span className="text-xs text-tertiary">All clear</span>
      ) : (
        <>
          {oldest && <span className="text-xs text-tertiary">oldest {oldest}</span>}
          <span className="w-8 text-right text-sm font-medium text-primary tabular-nums">{count}</span>
        </>
      )}
    </ListRow>
  );
}

export function DashboardView({ data, loading = false }: { data: DashboardData; loading?: boolean }) {
  const { generatedAt: now, providers, applications, payouts, contactGuard, refunds, activity, configMissing } = data;

  const appsOk = applications.ok ? applications.data : null;
  const bar = React.useCallback(
    (t: ChartTokens) =>
      barChartOption(t, { categories: appsOk?.weeks ?? [], series: appsOk?.stages ?? [], stack: true }),
    [appsOk]
  );
  const provOk = providers.ok ? providers.data : null;
  const donut = React.useCallback(
    (t: ChartTokens) => donutChartOption(t, { data: provOk?.buckets ?? [], centerLabel: 'Providers' }),
    [provOk]
  );
  const actOk = activity.ok ? activity.data : null;
  const line = React.useCallback(
    (t: ChartTokens) => lineChartOption(t, { categories: actOk?.days ?? [], series: actOk?.series ?? [], area: true }),
    [actOk]
  );

  const appsEmpty = !appsOk || appsOk.stages.every((s) => s.data.every((n) => n === 0));
  const missing = configMissing.ok ? configMissing.data : 0;
  const unavailable = (s: Section<unknown>) => (s.ok ? undefined : 'Could not load');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        className="mb-0"
        title="Dashboard"
        breadcrumbs={[{ label: 'Dashboard' }]}
        description="Pappal operational overview"
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href="/config">App config</Link>
          </Button>
        }
      />

      {missing > 0 && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg border border-hairline bg-warning-subtle px-3.5 py-2.5 text-sm text-body"
        >
          <WarningCircle size={16} className="shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {missing} config domain{missing > 1 ? 's have' : ' has'} no active version.
          </span>
          <Link href="/config" className="shrink-0 rounded-xs font-medium text-accent-fg hover:underline">
            Publish defaults
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
        ) : (
          <>
            <StatCard
              label="Providers"
              value={provOk ? provOk.total : '-'}
              sub={provOk ? `${provOk.online.toLocaleString('en-IN')} online now` : unavailable(providers)}
            />
            <StatCard
              label="Open applications"
              value={appsOk ? appsOk.open : '-'}
              sub={appsOk ? (appsOk.open > 0 ? `Oldest waiting ${age(appsOk.oldestOpenAt, now)}` : 'Queue is empty') : unavailable(applications)}
            />
            <StatCard
              label="Claimable payouts"
              value={payouts.ok ? payouts.data.claimableTokens : '-'}
              prefix="₹"
              sub={
                payouts.ok
                  ? `${payouts.data.claimableProviders} provider${payouts.data.claimableProviders === 1 ? '' : 's'}, ${payouts.data.payableProviders} payable`
                  : unavailable(payouts)
              }
            />
            <StatCard
              label="Paid out, last 30 days"
              value={payouts.ok ? rupees(payouts.data.paidPaise) : '-'}
              prefix="₹"
              trend={payouts.ok && payouts.data.paidTrend.some((n) => n > 0) ? payouts.data.paidTrend : undefined}
              sub={unavailable(payouts)}
            />
          </>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel heading="Applications per week" className="lg:col-span-2">
          <Body s={applications} loading={loading} height={240}>
            {() => (
              <Chart
                build={bar}
                height={240}
                empty={appsEmpty}
                emptyLabel="No submitted applications in the last 8 weeks"
                ariaLabel="Applications submitted per week over the last 8 weeks, stacked by current stage"
              />
            )}
          </Body>
        </Panel>

        <Panel heading="Providers by status">
          <Body s={providers} loading={loading} height={240}>
            {(p) => (
              <Chart
                build={donut}
                height={240}
                empty={p.total === 0}
                emptyLabel="No providers yet"
                ariaLabel="Providers by status"
              />
            )}
          </Body>
        </Panel>

        <Panel heading="Admin activity, last 14 days" className="lg:col-span-2">
          <Body s={activity} loading={loading} height={220}>
            {(a) => (
              <Chart
                build={line}
                height={220}
                empty={a.total === 0}
                emptyLabel="No admin activity in the last 14 days"
                ariaLabel="Config changes and admin actions per day over the last 14 days"
              />
            )}
          </Body>
        </Panel>

        <Panel heading="Needs attention" contentClassName="p-0">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <List className="[&>*:last-child]:border-b-0">
              <Attention
                href="/applications"
                state="progress"
                tone="info"
                label="Applications to review"
                count={appsOk ? appsOk.open : null}
                oldest={appsOk ? age(appsOk.oldestOpenAt, now) : ''}
              />
              <Attention
                href="/queues"
                state="todo"
                tone="warning"
                label="Contact-guard reviews"
                count={contactGuard.ok ? contactGuard.data.count : null}
                oldest={contactGuard.ok ? age(contactGuard.data.oldestAt, now) : ''}
              />
              <Attention
                href="/queues"
                state="todo"
                tone="warning"
                label="Refund reviews"
                count={refunds.ok ? refunds.data.count : null}
                oldest={refunds.ok ? age(refunds.data.oldestAt, now) : ''}
              />
              <Attention
                href="/payouts"
                state="todo"
                tone="success"
                label="Payouts ready to pay"
                count={payouts.ok ? payouts.data.payableProviders : null}
                oldest=""
              />
            </List>
          )}
        </Panel>
      </div>
    </div>
  );
}
