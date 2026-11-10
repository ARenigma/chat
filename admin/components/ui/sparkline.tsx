'use client';

import * as React from 'react';
import { Chart } from '@/components/ui/chart';
import { sparklineOption } from '@/lib/chart/options';

/** Axis-less trend line (ECharts). Import dynamically where it is optional (see stat-card). */
export default function Sparkline({ values, label, height = 36 }: { values: number[]; label: string; height?: number }) {
  const build = React.useCallback((t: Parameters<typeof sparklineOption>[0]) => sparklineOption(t, values), [values]);
  return <Chart build={build} height={height} ariaLabel={label} />;
}
