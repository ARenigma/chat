'use client';

import * as React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/stat-card';
import { Chart } from '@/components/ui/chart';
import { Panel } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { barChartOption, donutChartOption, lineChartOption, scatterChartOption } from '@/lib/chart/options';
import {
  APPLICATIONS_BY_WEEK,
  KPIS,
  PROVIDERS_BY_STATUS,
  SESSIONS_OVER_TIME,
  SESSION_VS_EARNINGS,
} from '../../fixtures';

export function DashboardDemo() {
  const [range, setRange] = React.useState('30d');
  const line = React.useCallback((t: Parameters<typeof lineChartOption>[0]) => lineChartOption(t, { ...SESSIONS_OVER_TIME, area: true }), []);
  const bar = React.useCallback((t: Parameters<typeof barChartOption>[0]) => barChartOption(t, { ...APPLICATIONS_BY_WEEK, stack: true }), []);
  const donut = React.useCallback((t: Parameters<typeof donutChartOption>[0]) => donutChartOption(t, { data: PROVIDERS_BY_STATUS, centerLabel: 'Providers' }), []);
  const scatter = React.useCallback(
    (t: Parameters<typeof scatterChartOption>[0]) =>
      scatterChartOption(t, { series: [{ name: 'Providers', data: SESSION_VS_EARNINGS }], xName: 'Minutes', yName: 'INR' }),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Pappal operational overview"
        actions={
          <Tabs value={range} onValueChange={setRange} className="gap-0">
            <TabsList className="h-7 gap-3 border-b-0">
              {['7d', '30d', '90d'].map((r) => (
                <TabsTrigger key={r} value={r} className="h-7">{r}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => (
          <StatCard key={k.label} {...k} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel heading="Sessions" className="lg:col-span-2">
          <Chart build={line} height={260} ariaLabel="Chat and voice sessions per day over the last 30 days" />
        </Panel>
        <Panel heading="Providers by status">
          <Chart build={donut} height={260} ariaLabel="Providers by status" />
        </Panel>
        <Panel heading="Applications per week">
          <Chart build={bar} height={220} ariaLabel="Approved and rejected applications per week" />
        </Panel>
        <Panel heading="Session length vs earnings" className="lg:col-span-2">
          <Chart build={scatter} height={220} ariaLabel="Scatter of session minutes against provider earnings" />
        </Panel>
      </div>
    </div>
  );
}
