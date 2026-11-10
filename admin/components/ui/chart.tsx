'use client';

import * as React from 'react';
import { echarts, type ChartOption } from '@/lib/chart/echarts';
import { readChartTokens, type ChartTokens } from '@/lib/chart/theme';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export interface ChartProps {
  /** Build the option from the resolved theme tokens (preferred: re-runs on theme change). */
  build: (tokens: ChartTokens) => ChartOption;
  /** Fixed height in px. Width follows the container. */
  height?: number;
  /** Show a skeleton instead of the chart. */
  loading?: boolean;
  /** Show the empty state instead of the chart (e.g. data.length === 0). */
  empty?: boolean;
  emptyLabel?: string;
  /** Accessible description of what the chart shows. */
  ariaLabel: string;
  className?: string;
}

/** Re-render when next-themes flips data-theme on <html>. A MutationObserver beats a hook here: child effects run before the provider sets the attribute. */
function useThemeVersion(): number {
  const [v, setV] = React.useState(0);
  React.useEffect(() => {
    const obs = new MutationObserver(() => setV((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return v;
}

/**
 * Thin typed wrapper around echarts/core. Builds its theme from the CSS tokens
 * at runtime, re-reads them on theme change, resizes with its container,
 * disposes on unmount, and handles loading/empty states.
 */
export function Chart({ build, height = 240, loading, empty, emptyLabel = 'No data yet', ariaLabel, className }: ChartProps) {
  const host = React.useRef<HTMLDivElement>(null);
  const instance = React.useRef<ReturnType<typeof echarts.init> | null>(null);
  const themeVersion = useThemeVersion();
  const showChart = !loading && !empty;

  // Create / dispose the instance when the chart becomes visible / hidden.
  React.useEffect(() => {
    const el = host.current;
    if (!showChart || !el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    instance.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      instance.current = null;
    };
  }, [showChart]);

  // (Re)apply the option whenever data, builder or theme changes.
  React.useEffect(() => {
    const chart = instance.current;
    if (!showChart || !chart) return;
    chart.setOption(build(readChartTokens()), { notMerge: true });
  }, [build, showChart, themeVersion]);

  return (
    <div className={cn('relative w-full', className)} style={{ height }}>
      {loading && <Skeleton className="absolute inset-0" />}
      {!loading && empty && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-hairline text-sm text-tertiary">
          {emptyLabel}
        </div>
      )}
      {showChart && <div ref={host} role="img" aria-label={ariaLabel} className="size-full" />}
    </div>
  );
}
