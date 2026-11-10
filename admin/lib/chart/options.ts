import type { ChartOption } from '@/lib/chart/echarts';
import { echarts } from '@/lib/chart/echarts';
import {
  chartTheme,
  compact,
  esc,
  seriesColor,
  tooltipRow,
  withAlpha,
  type ChartTokens,
} from '@/lib/chart/theme';

export interface Series {
  name: string;
  data: number[];
}

type Formatter = (n: number) => string;

type TipParam = {
  axisValueLabel?: string;
  name?: string;
  color?: string;
  seriesName?: string;
  value?: unknown;
  percent?: number;
};

function axisBase(t: ChartTokens, categories: string[], yFormat: Formatter) {
  return {
    xAxis: {
      type: 'category' as const,
      data: categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.hairline } },
      axisTick: { show: false },
      axisLabel: { color: t.textTertiary, fontSize: 11, margin: 10 },
    },
    yAxis: {
      type: 'value' as const,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: t.hairline } },
      axisLabel: { color: t.textTertiary, fontSize: 11, formatter: (v: number) => yFormat(v) },
    },
  };
}

function axisTooltip(t: ChartTokens, fmt: Formatter) {
  return {
    ...(chartTheme(t).tooltip as object),
    trigger: 'axis' as const,
    formatter: (raw: unknown) => {
      const params = (Array.isArray(raw) ? raw : [raw]) as TipParam[];
      const head = params[0]?.axisValueLabel ?? '';
      const rows = params
        .map((p) => tooltipRow(t, p.color ?? t.accent, p.seriesName ?? '', fmt(Number(p.value))))
        .join('');
      return `<div style="color:${t.textSecondary};margin-bottom:4px">${esc(head)}</div>${rows}`;
    },
  };
}

/** Line (or area) chart. Series 1 is the brand accent. */
export function lineChartOption(
  t: ChartTokens,
  o: { categories: string[]; series: Series[]; area?: boolean; stack?: boolean; format?: Formatter; legend?: boolean }
): ChartOption {
  const fmt = o.format ?? compact;
  const base = chartTheme(t);
  return {
    ...base,
    legend: { ...(base.legend as object), show: o.legend ?? o.series.length > 1, top: 0, right: 0 },
    grid: { ...(base.grid as object), top: o.series.length > 1 ? 32 : 12 },
    tooltip: axisTooltip(t, fmt),
    ...axisBase(t, o.categories, fmt),
    series: o.series.map((s, i) => {
      const c = seriesColor(t, i);
      return {
        name: s.name,
        type: 'line',
        data: s.data,
        stack: o.stack ? 'total' : undefined,
        smooth: 0.2,
        showSymbol: false,
        symbolSize: 6,
        lineStyle: { width: 1.5, color: c },
        itemStyle: { color: c, borderColor: t.surface, borderWidth: 2 },
        emphasis: { focus: 'series', lineStyle: { width: 1.5 } },
        areaStyle: o.area
          ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: withAlpha(c, 0.14) },
                { offset: 1, color: withAlpha(c, 0) },
              ]),
            }
          : undefined,
      };
    }),
  };
}

/** Vertical or horizontal bars. Slim 4px-radius bars, hairline grid. */
export function barChartOption(
  t: ChartTokens,
  o: { categories: string[]; series: Series[]; horizontal?: boolean; stack?: boolean; format?: Formatter; legend?: boolean }
): ChartOption {
  const fmt = o.format ?? compact;
  const base = chartTheme(t);
  const ax = axisBase(t, o.categories, fmt);
  const catAxis = { ...ax.xAxis, boundaryGap: true, axisLine: { lineStyle: { color: t.hairline } } };
  const valAxis = ax.yAxis;
  return {
    ...base,
    legend: { ...(base.legend as object), show: o.legend ?? o.series.length > 1, top: 0, right: 0 },
    grid: { ...(base.grid as object), top: o.series.length > 1 ? 32 : 12 },
    tooltip: { ...axisTooltip(t, fmt), axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(t.text, 0.04) } } },
    xAxis: o.horizontal ? valAxis : catAxis,
    yAxis: o.horizontal ? { ...catAxis, inverse: true, axisLine: { show: false } } : valAxis,
    series: o.series.map((s, i) => ({
      name: s.name,
      type: 'bar',
      data: s.data,
      stack: o.stack ? 'total' : undefined,
      barMaxWidth: 20,
      itemStyle: {
        color: seriesColor(t, i),
        borderRadius: o.stack ? 0 : o.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
      },
      emphasis: { itemStyle: { color: seriesColor(t, i), opacity: 0.85 } },
    })),
  };
}

/** Donut with a centred total. */
export function donutChartOption(
  t: ChartTokens,
  o: { data: { name: string; value: number }[]; centerLabel?: string; format?: Formatter }
): ChartOption {
  const fmt = o.format ?? compact;
  const total = o.data.reduce((a, d) => a + d.value, 0);
  const base = chartTheme(t);
  return {
    ...base,
    grid: undefined,
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      formatter: (raw: unknown) => {
        const p = raw as TipParam;
        return tooltipRow(t, p.color ?? t.accent, p.name ?? '', `${fmt(Number(p.value))} · ${Math.round(p.percent ?? 0)}%`);
      },
    },
    legend: { ...(base.legend as object), orient: 'vertical', right: 0, top: 'middle' },
    title: {
      text: fmt(total),
      subtext: o.centerLabel ?? 'Total',
      left: '34%',
      top: '40%',
      textAlign: 'center',
      textStyle: { color: t.text, fontSize: 20, fontWeight: 600, fontFamily: t.fontFamily },
      subtextStyle: { color: t.textTertiary, fontSize: 11 },
      itemGap: 2,
    },
    series: [
      {
        type: 'pie',
        radius: ['66%', '82%'],
        center: ['34%', '50%'],
        padAngle: 2,
        itemStyle: { borderRadius: 3, borderColor: t.surface, borderWidth: 0 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scaleSize: 3 },
        data: o.data.map((d, i) => ({ ...d, itemStyle: { color: seriesColor(t, i) } })),
      },
    ],
  };
}

/** Scatter: each series is a list of [x, y] points. */
export function scatterChartOption(
  t: ChartTokens,
  o: { series: { name: string; data: [number, number][] }[]; xName?: string; yName?: string; format?: Formatter }
): ChartOption {
  const fmt = o.format ?? compact;
  const base = chartTheme(t);
  const axis = (name?: string) => ({
    type: 'value' as const,
    name,
    nameLocation: 'end' as const,
    nameTextStyle: { color: t.textTertiary, fontSize: 11 },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.hairline, type: 'dashed' as const } },
    axisLabel: { color: t.textTertiary, fontSize: 11, formatter: (v: number) => fmt(v) },
  });
  return {
    ...base,
    legend: { ...(base.legend as object), show: o.series.length > 1, top: 0, right: 0 },
    grid: { ...(base.grid as object), top: 28 },
    tooltip: {
      ...(base.tooltip as object),
      trigger: 'item',
      axisPointer: { type: 'cross', lineStyle: { color: t.hairlineStrong, type: 'dashed' } },
      formatter: (raw: unknown) => {
        const p = raw as TipParam;
        const [x, y] = (p.value as [number, number]) ?? [0, 0];
        return (
          `<div style="color:${t.textSecondary};margin-bottom:4px">${esc(p.seriesName ?? '')}</div>` +
          tooltipRow(t, p.color ?? t.accent, o.xName ?? 'x', fmt(x)) +
          tooltipRow(t, p.color ?? t.accent, o.yName ?? 'y', fmt(y))
        );
      },
    },
    xAxis: axis(o.xName),
    yAxis: axis(o.yName),
    series: o.series.map((s, i) => ({
      name: s.name,
      type: 'scatter',
      data: s.data,
      symbolSize: 6,
      itemStyle: { color: seriesColor(t, i), opacity: 0.9 },
      emphasis: { scale: 1.4 },
    })),
  };
}

/** Axis-less trend line for stat cards. Brand accent by default. */
export function sparklineOption(t: ChartTokens, values: number[], o: { color?: string; area?: boolean } = {}): ChartOption {
  const c = o.color ?? seriesColor(t, 0);
  return {
    backgroundColor: 'transparent',
    animation: t.animate,
    animationDuration: 400,
    animationEasing: 'cubicOut',
    grid: { left: 2, right: 2, top: 3, bottom: 3 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false, min: 'dataMin', max: 'dataMax' },
    tooltip: { show: false },
    series: [
      {
        type: 'line',
        data: values,
        smooth: 0.25,
        showSymbol: false,
        silent: true,
        lineStyle: { width: 1.5, color: c },
        areaStyle: (o.area ?? true)
          ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: withAlpha(c, 0.2) },
                { offset: 1, color: withAlpha(c, 0) },
              ]),
            }
          : undefined,
      },
    ],
  };
}
